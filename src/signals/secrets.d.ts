// Channel delivery secrets — set via `wrangler secret put`, NEVER as wrangler.jsonc vars (which are
// committed plaintext). `wrangler types` only emits vars/bindings, so these are declared here and
// merged into the generated global `Env` interface (worker-configuration.d.ts). All optional: a
// channel is active only when its required secret(s) are present (checked at the queue() wiring site).
// This file is a global script (no import/export) so the `interface Env` declaration merges.
interface Env {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_TARGET_ID?: string;
  WEBHOOK_URL?: string;
  WEBHOOK_SIGNING_SECRET?: string;
}
