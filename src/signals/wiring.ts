import type { Fetcher, ObservabilitySink } from '../domain/ports';
import type { Notifier } from './notifier';
import { FanOutNotifier } from './notifiers/fan-out';
import { LineNotifier } from './notifiers/line';
import { TelegramNotifier } from './notifiers/telegram';
import { WebhookNotifier } from './notifiers/webhook';

/**
 * Build the fan-out notifier from env secrets. A channel is active only when ALL its required
 * secret(s) are present (set via `wrangler secret put`); otherwise that channel self-skips. The
 * `fetcher` is the call-time-resolving injectable — never a module-init `globalThis.fetch` capture.
 */
export function buildNotifier(fetcher: Fetcher, env: Env, obs: ObservabilitySink): Notifier {
  const telegram =
    env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
      ? { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }
      : undefined;
  const line =
    env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_TARGET_ID
      ? { channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN, targetId: env.LINE_TARGET_ID }
      : undefined;
  const webhook =
    env.WEBHOOK_URL && env.WEBHOOK_SIGNING_SECRET
      ? { url: env.WEBHOOK_URL, signingSecret: env.WEBHOOK_SIGNING_SECRET }
      : undefined;
  return new FanOutNotifier([
    new TelegramNotifier(fetcher, telegram, obs),
    new LineNotifier(fetcher, line),
    new WebhookNotifier(fetcher, webhook),
  ]);
}
