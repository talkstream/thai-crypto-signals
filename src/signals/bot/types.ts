import type {
  BotConfigStore,
  Clock,
  ObservabilitySink,
  SignalConfigStore,
  SymbolStore,
} from '../../domain/ports';
import type { SignalConfig } from '../config';

// --- Telegram wire types (only the fields we read) ---
export interface TgChat {
  id: number;
}
export interface TgMessage {
  message_id: number;
  chat: TgChat;
  text?: string;
}
export interface TgCallbackQuery {
  id: string;
  data?: string;
  message?: TgMessage;
}
export interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

// --- Inline keyboard / menu ---
export interface InlineButton {
  text: string;
  callback_data: string;
}
export type InlineKeyboard = InlineButton[][];
export interface Menu {
  text: string;
  keyboard: InlineKeyboard;
}

/** Result of a Telegram Bot API call. `ok` is the HTTP-2xx + Telegram `ok:true`; status is the HTTP code. */
export interface BotApiResult {
  ok: boolean;
  status: number;
}

/** The Telegram Bot API client the router drives (implemented in bot/api.ts over the injected Fetcher). */
export interface BotApi {
  sendMessage(chatId: string, text: string, keyboard?: InlineKeyboard): Promise<BotApiResult>;
  editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    keyboard?: InlineKeyboard,
  ): Promise<BotApiResult>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<BotApiResult>;
  setWebhook(url: string, secretToken: string): Promise<BotApiResult>;
}

/** Everything the update router needs (built per-request in src/index.ts; null when the bot is disabled). */
export interface BotDeps {
  api: BotApi;
  config: SignalConfigStore & BotConfigStore;
  symbols: SymbolStore;
  /** The allowlisted operator chat id (TELEGRAM_CHAT_ID), as a string. */
  chatId: string;
  clock: Clock;
  obs: ObservabilitySink;
  /** Env-seeded fallback used to materialize an absent config row. */
  defaults: SignalConfig;
}
