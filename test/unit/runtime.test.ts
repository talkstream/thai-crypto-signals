import { describe, expect, it } from 'vitest';
import { SystemClock, SystemRng } from '../../src/adapters/runtime';

describe('SystemClock', () => {
  it('now() returns a numeric timestamp', () => {
    expect(typeof new SystemClock().now()).toBe('number');
  });
  it('sleep() resolves', async () => {
    await expect(new SystemClock().sleep(1)).resolves.toBeUndefined();
  });
});

describe('SystemRng', () => {
  it('nextUnit() is in [0, 1)', () => {
    const v = new SystemRng().nextUnit();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});
