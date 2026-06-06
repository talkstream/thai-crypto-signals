// D1 minor-unit conversions. D1 rejects bigint binds and returns INTEGER as JS number;
// values are guaranteed <= 2^53-1 by the parse-time ScaleOverflow guard, so Number/BigInt
// conversions are exact. No defensive (unreachable) branch here — the guard is the gate.

export const minorToDb = (minor: bigint): number => Number(minor);

export const minorToDbNullable = (minor: bigint | null): number | null =>
  minor === null ? null : Number(minor);

export const minorFromDb = (value: number): bigint => BigInt(value);

export const minorFromDbNullable = (value: number | null): bigint | null =>
  value === null ? null : BigInt(value);

/** True for a D1/SQLite UNIQUE/PK constraint violation — used to detect a duplicate bucket. */
export function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}
