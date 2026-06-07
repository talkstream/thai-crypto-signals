import type { InlineButton, InlineKeyboard, Menu } from './types';

// Pure inline-keyboard builders. Plain text, no parse_mode (injection-safe). All callback_data is
// authored from the fixed scheme decoded in bot/parse.ts.

const THRESHOLD_BUTTONS_BP = [100, 300, 500, 1000]; // 1 / 3 / 5 / 10 %
const ADD_PRESETS = ['BTC_THB', 'ETH_THB', 'XRP_THB', 'SOL_THB', 'DOGE_THB', 'TON_THB'];
const BACK: InlineButton = { text: '« Назад', callback_data: 'm' };

function base(symbol: string): string {
  return symbol.replace(/_.*$/, ''); // "TON_THB" -> "TON" (total: no array-index undefined)
}
function pct(bp: number): string {
  return `${bp / 100}%`;
}
/** Pack buttons two per row. */
function grid(buttons: InlineButton[]): InlineKeyboard {
  const rows: InlineKeyboard = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

export function mainMenu(cfg: { watchlist: string[]; thresholdBp: number }): Menu {
  const watched = cfg.watchlist.length > 0 ? cfg.watchlist.map(base).join(', ') : 'все символы';
  return {
    text: `⚙️ Сигналы TCS\n\n📡 Слежу: ${watched}\n📈 Порог: ${pct(cfg.thresholdBp)}`,
    keyboard: [
      [
        { text: '➕ Токен', callback_data: 'a' },
        { text: '➖ Убрать', callback_data: 'r' },
      ],
      [{ text: '📈 Порог', callback_data: 't' }],
    ],
  };
}

export function thresholdMenu(cfg: { thresholdBp: number }): Menu {
  const buttons = THRESHOLD_BUTTONS_BP.map((bp) => ({
    text: bp === cfg.thresholdBp ? `• ${pct(bp)} •` : pct(bp),
    callback_data: `t:${bp}`,
  }));
  return {
    text: 'Порог уведомления — насколько цена должна двинуться за 2 минуты:',
    keyboard: [...grid(buttons), [{ text: '✏️ Своё', callback_data: 't:x' }, BACK]],
  };
}

export function addMenu(cfg: { watchlist: string[] }): Menu {
  const present = new Set(cfg.watchlist);
  const buttons = ADD_PRESETS.filter((s) => !present.has(s)).map((s) => ({
    text: base(s),
    callback_data: `a:${s}`,
  }));
  return {
    text: 'Какой токен добавить? (или ✏️ — введите тикер, напр. ADA)',
    keyboard: [...grid(buttons), [{ text: '✏️ Ввести тикер', callback_data: 'a:x' }, BACK]],
  };
}

export function removeMenu(cfg: { watchlist: string[] }): Menu {
  const buttons = cfg.watchlist.map((s) => ({ text: base(s), callback_data: `r:${s}` }));
  const text =
    cfg.watchlist.length === 0
      ? 'Список пуст — сейчас отслеживаются все символы.'
      : cfg.watchlist.length === 1
        ? '⚠️ Уберёте последний — тогда сработают ВСЕ символы. Что убрать?'
        : 'Какой токен убрать?';
  return { text, keyboard: [...grid(buttons), [BACK]] };
}
