import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../../src/domain/ports';
import { TelegramNotifier } from '../../src/signals/notifiers/telegram';
import type { SignalJob } from '../../src/signals/types';
import { InMemoryObservabilitySink, recordingFetcher } from '../helpers/fakes';

const JOB: SignalJob = {
  bucketTs: 1_700_000_040_000,
  symbols: ['BTC_THB', 'ETH_THB'],
  producedAt: 1,
  schemaVersion: 1,
};
const CFG = { botToken: 'T0KEN', chatId: '775707' };

function notifier(fetcher: Fetcher, cfg: typeof CFG | undefined = CFG) {
  return new TelegramNotifier(fetcher, cfg, new InMemoryObservabilitySink());
}

describe('TelegramNotifier', () => {
  it('POSTs JSON {chat_id,text} to sendMessage with no parse_mode on success', async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const f = recordingFetcher((url, init) => {
      seen = { url, init };
      return Response.json({ ok: true, result: {} });
    });
    const r = await notifier(f.fetcher).deliver(JOB);

    expect(r.delivered).toBe(1);
    expect(r.nonIdempotentDelivered).toBe(1); // Telegram has no idempotency key
    expect(seen?.url).toBe('https://api.telegram.org/botT0KEN/sendMessage');
    expect(seen?.init?.method).toBe('POST');
    expect(new Headers(seen?.init?.headers).get('content-type')).toBe('application/json');
    const body = JSON.parse(String(seen?.init?.body)) as Record<string, unknown>;
    expect(body.chat_id).toBe('775707');
    expect(body.text).toBe('TCS signal 2023-11-15 05:14 ICT — 2 symbols moved: BTC_THB, ETH_THB');
    expect('parse_mode' in body).toBe(false); // literal text, injection-safe
  });

  it('treats 429 as transient and reads parameters.retry_after from the JSON body', async () => {
    const f = recordingFetcher(
      () =>
        new Response(
          JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 30 } }),
          {
            status: 429,
          },
        ),
    );
    const r = await notifier(f.fetcher).deliver(JOB);
    expect(r.transientFailures).toBe(1);
    expect(r.retryAfterSec).toBe(30);
  });

  it('falls back to the Retry-After header when the body lacks parameters', async () => {
    const f = recordingFetcher(
      () =>
        new Response(JSON.stringify({ ok: false, error_code: 429 }), {
          status: 429,
          headers: { 'Retry-After': '12' },
        }),
    );
    const r = await notifier(f.fetcher).deliver(JOB);
    expect(r.transientFailures).toBe(1);
    expect(r.retryAfterSec).toBe(12);
  });

  it('treats 5xx as ambiguous (no idempotency key — do not retry-duplicate)', async () => {
    const f = recordingFetcher(() => new Response('boom', { status: 503 }));
    const r = await notifier(f.fetcher).deliver(JOB);
    expect(r.ambiguousFailures).toBe(1);
    expect(r.transientFailures).toBe(0);
  });

  it('treats a network throw as ambiguous (the send may already have reached Telegram)', async () => {
    const f = recordingFetcher(() => {
      throw new TypeError('network down');
    });
    const r = await notifier(f.fetcher).deliver(JOB);
    expect(r.ambiguousFailures).toBe(1);
    expect(r.transientFailures).toBe(0);
  });

  it('treats a 4xx (non-429) as permanent with no retry', async () => {
    const f = recordingFetcher(
      () =>
        new Response(
          JSON.stringify({ ok: false, error_code: 400, description: 'chat not found' }),
          {
            status: 400,
          },
        ),
    );
    const r = await notifier(f.fetcher).deliver(JOB);
    expect(r.permanentFailures).toBe(1);
    expect(f.calls).toBe(1);
  });

  it('surfaces a distinct obs event for 401/403 (dead token / blocked)', async () => {
    const obs = new InMemoryObservabilitySink();
    const f = recordingFetcher(() => new Response('forbidden', { status: 403 }));
    const r = await new TelegramNotifier(f.fetcher, CFG, obs).deliver(JOB);
    expect(r.permanentFailures).toBe(1);
    expect(obs.events.some((e) => e.kind === 'notify_telegram_auth')).toBe(true);
  });

  it('skips (no request) when the secret is absent', async () => {
    const f = recordingFetcher(() => Response.json({ ok: true }));
    const r = await new TelegramNotifier(
      f.fetcher,
      undefined,
      new InMemoryObservabilitySink(),
    ).deliver(JOB);
    expect(r.skipped).toBe(1);
    expect(f.calls).toBe(0);
  });
});
