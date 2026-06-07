import { describe, expect, it } from 'vitest';
import { addMenu, mainMenu, removeMenu, thresholdMenu } from '../../src/signals/bot/menu';

const data = (m: { keyboard: { callback_data: string }[][] }) =>
  m.keyboard.flat().map((b) => b.callback_data);

describe('mainMenu', () => {
  it('shows the watched base tickers + threshold %, with the 3 action buttons', () => {
    const m = mainMenu({ watchlist: ['TON_THB', 'BTC_THB'], thresholdBp: 300 });
    expect(m.text).toContain('Слежу: TON, BTC');
    expect(m.text).toContain('Порог: 3%');
    expect(data(m)).toEqual(['a', 'r', 't']);
  });

  it('shows "все символы" for an empty watchlist', () => {
    expect(mainMenu({ watchlist: [], thresholdBp: 1000 }).text).toContain('Слежу: все символы');
  });
});

describe('thresholdMenu', () => {
  it('marks the current threshold and offers custom + back', () => {
    const m = thresholdMenu({ thresholdBp: 300 });
    const labels = m.keyboard.flat().map((b) => b.text);
    expect(labels).toContain('• 3% •'); // current, marked
    expect(labels).toContain('1%'); // others, plain
    expect(data(m)).toContain('t:x');
    expect(data(m)).toContain('m');
  });
});

describe('addMenu', () => {
  it('lists presets minus already-watched ones, plus custom + back', () => {
    const m = addMenu({ watchlist: ['BTC_THB', 'TON_THB'] });
    expect(data(m)).toContain('a:ETH_THB');
    expect(data(m)).not.toContain('a:BTC_THB'); // already watched -> excluded
    expect(data(m)).not.toContain('a:TON_THB');
    expect(data(m)).toContain('a:x');
    expect(data(m)).toContain('m');
  });
});

describe('removeMenu', () => {
  it('lists the watchlist and warns when removing the last symbol', () => {
    const one = removeMenu({ watchlist: ['TON_THB'] });
    expect(one.text).toContain('последний');
    expect(data(one)).toEqual(['r:TON_THB', 'm']);
  });

  it('uses a plain prompt with more than one symbol', () => {
    expect(removeMenu({ watchlist: ['A_THB', 'B_THB'] }).text).toContain('убрать');
  });

  it('notes when the list is empty', () => {
    expect(removeMenu({ watchlist: [] }).text).toContain('пуст');
  });
});
