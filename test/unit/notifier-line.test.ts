import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../../src/domain/ports';
import { lineRetryKey } from '../../src/signals/format';
import { LineNotifier } from '../../src/signals/notifiers/line';
import type { SignalJob } from '../../src/signals/types';
import { recordingFetcher } from '../helpers/fakes';

const JOB: SignalJob = {
  bucketTs: 1_700_000_040_000,
  symbols: ['BTC_THB'],
  producedAt: 1,
  schemaVersion: 1,
};
const CFG = { channelAccessToken: 'CHTOKEN', targetId: 'Udeadbeef' };

function notifier(fetcher: Fetcher, cfg: typeof CFG | undefined = CFG) {
  return new LineNotifier(fetcher, cfg);
}

describe('LineNotifier', () => {
  it('POSTs to the push endpoint with Bearer auth, the text message, and a stable retry key', async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const f = recordingFetcher((url, init) => {
      seen = { url, init };
      return Response.json({});
    });
    const r = await notifier(f.fetcher).deliver(JOB);

    expect(r.delivered).toBe(1);
    expect(seen?.url).toBe('https://api.line.me/v2/bot/message/push');
    expect(seen?.init?.method).toBe('POST');
    const headers = new Headers(seen?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer CHTOKEN');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-line-retry-key')).toBe(lineRetryKey(JOB.bucketTs)); // deterministic per bucket
    const body = JSON.parse(String(seen?.init?.body)) as {
      to: string;
      messages: Array<{ type: string; text: string }>;
    };
    expect(body.to).toBe('Udeadbeef');
    expect(body.messages).toEqual([
      { type: 'text', text: 'TCS signal 2023-11-15 05:14 ICT — 1 symbol moved: BTC_THB' },
    ]);
  });

  it('treats a 409 (retry-key replay) as delivered, not an error', async () => {
    const f = recordingFetcher(() => new Response('conflict', { status: 409 }));
    expect((await notifier(f.fetcher).deliver(JOB)).delivered).toBe(1);
  });

  it('treats 429 as transient, reading Retry-After only if present', async () => {
    const withHeader = recordingFetcher(
      () => new Response('rl', { status: 429, headers: { 'Retry-After': '7' } }),
    );
    const a = await notifier(withHeader.fetcher).deliver(JOB);
    expect(a.transientFailures).toBe(1);
    expect(a.retryAfterSec).toBe(7);

    const noHeader = recordingFetcher(() => new Response('rl', { status: 429 }));
    const b = await notifier(noHeader.fetcher).deliver(JOB);
    expect(b.transientFailures).toBe(1);
    expect(b.retryAfterSec).toBeUndefined(); // LINE has no guaranteed Retry-After -> platform default
  });

  it('treats 5xx and network throws as transient', async () => {
    const fivexx = recordingFetcher(() => new Response('boom', { status: 502 }));
    expect((await notifier(fivexx.fetcher).deliver(JOB)).transientFailures).toBe(1);
    const thrown = recordingFetcher(() => {
      throw new TypeError('down');
    });
    expect((await notifier(thrown.fetcher).deliver(JOB)).transientFailures).toBe(1);
  });

  it('treats a 4xx (non-429) as permanent', async () => {
    const f = recordingFetcher(
      () => new Response(JSON.stringify({ message: 'invalid token' }), { status: 401 }),
    );
    expect((await notifier(f.fetcher).deliver(JOB)).permanentFailures).toBe(1);
  });

  it('skips (no request) when the secret is absent', async () => {
    const f = recordingFetcher(() => Response.json({}));
    const r = await new LineNotifier(f.fetcher, undefined).deliver(JOB);
    expect(r.skipped).toBe(1);
    expect(f.calls).toBe(0);
  });
});
