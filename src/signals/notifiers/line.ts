import type { Fetcher } from '../../domain/ports';
import { formatSignalMessage, lineRetryKey } from '../format';
import type { DeliveryResult, Notifier } from '../notifier';
import type { SignalJob } from '../types';
import { retryAfterHeader } from './http';
import * as R from './result';

export interface LineConfig {
  channelAccessToken: string;
  targetId: string;
}

/**
 * LINE Messaging API push. Success is HTTP status only (no `ok` field). A deterministic
 * `X-Line-Retry-Key` per bucket lets LINE dedupe across queue retries — a replay of an already-2xx
 * request returns 409, which we treat as delivered. `fetch` is resolved via the injected Fetcher.
 */
export class LineNotifier implements Notifier {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly cfg: LineConfig | undefined,
  ) {}

  async deliver(job: SignalJob): Promise<DeliveryResult> {
    if (!this.cfg) return R.skipped();
    const text = formatSignalMessage(job); // local formatting, outside the transport try/catch
    let res: Response;
    try {
      res = await this.fetcher('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.channelAccessToken}`,
          'X-Line-Retry-Key': lineRetryKey(job.bucketTs),
        },
        body: JSON.stringify({
          to: this.cfg.targetId,
          messages: [{ type: 'text', text }],
        }),
      });
    } catch {
      return R.transient(); // network error — retry
    }
    if (res.ok || res.status === 409) return R.delivered(); // 409 = retry-key replay (already sent)
    if (res.status === 429) return R.transient(retryAfterHeader(res)); // LINE rarely sets Retry-After
    if (res.status >= 500) return R.transient();
    return R.permanent();
  }
}
