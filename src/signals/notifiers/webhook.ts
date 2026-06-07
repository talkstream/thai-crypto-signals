import type { Fetcher } from '../../domain/ports';
import { formatSignalMessage } from '../format';
import type { DeliveryResult, Notifier } from '../notifier';
import type { SignalJob } from '../types';
import { retryAfterHeader } from './http';
import * as R from './result';

export interface WebhookConfig {
  url: string;
  signingSecret: string;
}

/** HMAC-SHA256 hex of `message` keyed by `secret` (Web Crypto — available in workerd and the pool). */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
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

/**
 * Generic signed webhook. The signed body carries `bucketTs` so the receiver can dedupe (delivery is
 * at-least-once). `X-TCS-Signature: sha256=<hex>` is an HMAC over the EXACT bytes sent. `fetch` is
 * resolved via the injected Fetcher at call time.
 */
export class WebhookNotifier implements Notifier {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly cfg: WebhookConfig | undefined,
  ) {}

  async deliver(job: SignalJob): Promise<DeliveryResult> {
    if (!this.cfg) return R.skipped();
    const body = JSON.stringify({
      bucketTs: job.bucketTs,
      movers: job.movers,
      producedAt: job.producedAt,
      schemaVersion: job.schemaVersion,
      text: formatSignalMessage(job),
    });
    const signature = await hmacSha256Hex(this.cfg.signingSecret, body);
    let res: Response;
    try {
      res = await this.fetcher(this.cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TCS-Signature': `sha256=${signature}` },
        body,
      });
    } catch {
      return R.transient(); // network error — retry
    }
    if (res.ok) return R.delivered();
    if (res.status === 429) return R.transient(retryAfterHeader(res));
    if (res.status >= 500) return R.transient();
    return R.permanent();
  }
}
