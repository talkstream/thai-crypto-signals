import { describe, expect, it } from 'vitest';
import { KvCacheWriter } from '../../src/adapters/storage/cache-writer';
import {
  isUniqueConstraintError,
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

describe('isUniqueConstraintError', () => {
  it('matches only UNIQUE constraint failures', () => {
    expect(isUniqueConstraintError(new Error('D1_ERROR: UNIQUE constraint failed: x'))).toBe(true);
    expect(isUniqueConstraintError(new Error('no such table'))).toBe(false);
    expect(isUniqueConstraintError('not an error')).toBe(false);
  });
});

describe('KvCacheWriter', () => {
  it('passes expirationTtl only when a ttl is given', async () => {
    const calls: Array<unknown> = [];
    const kv = {
      put: async (_k: string, _v: string, options?: unknown) => {
        calls.push(options);
      },
    } as unknown as KVNamespace;
    const writer = new KvCacheWriter(kv);
    await writer.put('a', '1', 60);
    await writer.put('b', '2');
    expect(calls[0]).toEqual({ expirationTtl: 60 });
    expect(calls[1]).toBeUndefined();
  });
});
