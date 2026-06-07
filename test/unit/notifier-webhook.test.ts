import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../../src/domain/ports';
import { WebhookNotifier } from '../../src/signals/notifiers/webhook';
import type { SignalJob } from '../../src/signals/types';
import { recordingFetcher } from '../helpers/fakes';

const JOB: SignalJob = {
  bucketTs: 1_700_000_040_000,
  symbols: ['BTC_THB', 'ETH_THB'],
  producedAt: 42,
  schemaVersion: 1,
};
const CFG = { url: 'https://example.test/hook', signingSecret: 's3cr3t' };

// Real WebCrypto in the Workers test pool — no mock. The test independently recomputes the HMAC over
// the exact body the notifier sent and asserts the header matches it (proves it signs what it sends).
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function notifier(fetcher: Fetcher, cfg: typeof CFG | undefined = CFG) {
  return new WebhookNotifier(fetcher, cfg);
}

describe('WebhookNotifier', () => {
  it('POSTs a signed JSON body (incl. bucketTs) with an HMAC-SHA256 header byte-matching the body', async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const f = recordingFetcher((url, init) => {
      seen = { url, init };
      return Response.json({});
    });
    const r = await notifier(f.fetcher).deliver(JOB);

    expect(r.delivered).toBe(1);
    expect(r.nonIdempotentDelivered).toBe(0); // webhook receiver dedups on the signed bucketTs
    expect(seen?.url).toBe('https://example.test/hook');
    expect(seen?.init?.method).toBe('POST');
    expect(new Headers(seen?.init?.headers).get('content-type')).toBe('application/json');

    const sentBody = String(seen?.init?.body);
    const parsed = JSON.parse(sentBody) as Record<string, unknown>;
    expect(parsed.bucketTs).toBe(JOB.bucketTs); // receiver can dedupe on bucketTs
    expect(parsed.schemaVersion).toBe(1);

    const header = new Headers(seen?.init?.headers).get('x-tcs-signature');
    expect(header).toBe(`sha256=${await hmacHex(CFG.signingSecret, sentBody)}`);
  });

  it('treats 429 (Retry-After honored), 5xx, and network throws as transient', async () => {
    const rl = recordingFetcher(
      () => new Response('rl', { status: 429, headers: { 'Retry-After': '9' } }),
    );
    const a = await notifier(rl.fetcher).deliver(JOB);
    expect(a.transientFailures).toBe(1);
    expect(a.retryAfterSec).toBe(9);

    const fivexx = recordingFetcher(() => new Response('boom', { status: 500 }));
    expect((await notifier(fivexx.fetcher).deliver(JOB)).transientFailures).toBe(1);

    const thrown = recordingFetcher(() => {
      throw new TypeError('down');
    });
    expect((await notifier(thrown.fetcher).deliver(JOB)).transientFailures).toBe(1);
  });

  it('treats a 4xx (non-429) as permanent', async () => {
    const f = recordingFetcher(() => new Response('bad request', { status: 400 }));
    expect((await notifier(f.fetcher).deliver(JOB)).permanentFailures).toBe(1);
  });

  it('skips (no request, no signing) when config is absent', async () => {
    const f = recordingFetcher(() => Response.json({}));
    const r = await new WebhookNotifier(f.fetcher, undefined).deliver(JOB);
    expect(r.skipped).toBe(1);
    expect(f.calls).toBe(0);
  });
});
