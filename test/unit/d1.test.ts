import { describe, expect, it } from 'vitest';
import {
  minorFromDb,
  minorFromDbNullable,
  minorToDb,
  minorToDbNullable,
} from '../../src/adapters/storage/d1';

describe('d1 minor conversions', () => {
  it('round-trips bigint <-> db number', () => {
    expect(minorToDb(200000000n)).toBe(200000000);
    expect(minorFromDb(200000000)).toBe(200000000n);
  });

  it('handles nullable variants', () => {
    expect(minorToDbNullable(null)).toBeNull();
    expect(minorToDbNullable(5n)).toBe(5);
    expect(minorFromDbNullable(null)).toBeNull();
    expect(minorFromDbNullable(5)).toBe(5n);
  });
});
