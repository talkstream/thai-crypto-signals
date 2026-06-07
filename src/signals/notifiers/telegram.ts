import { safeEvent } from '../../domain/obs';
import type { Fetcher, ObservabilitySink } from '../../domain/ports';
import { formatSignalMessage } from '../format';
import type { DeliveryResult, Notifier } from '../notifier';
import type { SignalJob } from '../types';
import { retryAfterHeader } from './http';
import * as R from './result';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/** On a 429 Telegram returns the wait in the JSON body's `parameters.retry_after` (seconds). */
async function telegramRetryAfter(res: Response): Promise<number | undefined> {
  try {
    const body = (await res.json()) as { parameters?: { retry_after?: unknown } };
    const ra = body?.parameters?.retry_after;
    if (typeof ra === 'number' && Number.isFinite(ra) && ra > 0) return ra;
  } catch {
    // body was not JSON — fall back to the standard header
  }
  return retryAfterHeader(res);
}

/**
 * Telegram Bot API sendMessage. `fetch` is resolved via the injected {@link Fetcher} at CALL time
 * (a module-init `globalThis.fetch` capture silently breaks outbound subrequests in workerd). Plain
 * text, NO parse_mode — the body is injection-safe without MarkdownV2 escaping.
 */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly cfg: TelegramConfig | undefined,
    private readonly obs: ObservabilitySink,
  ) {}

  async deliver(job: SignalJob): Promise<DeliveryResult> {
    if (!this.cfg) return R.skipped();
    const text = formatSignalMessage(job); // local formatting, outside the transport try/catch
    let res: Response;
    try {
      res = await this.fetcher(`https://api.telegram.org/bot${this.cfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.cfg.chatId, text }),
      });
    } catch {
      return R.transient(); // network error — retry
    }
    if (res.ok) return R.delivered();
    if (res.status === 429) return R.transient(await telegramRetryAfter(res));
    if (res.status >= 500) return R.transient();
    if (res.status === 401 || res.status === 403) {
      // operator misconfig (dead token) or the bot was blocked — surface it, still permanent.
      safeEvent(this.obs, 'notify_telegram_auth', { status: String(res.status) }, { count: 1 });
    }
    return R.permanent();
  }
}
