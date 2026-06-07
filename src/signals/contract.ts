/**
 * Compile-time contract for the signals wire shape and dispatcher port.
 *
 * The entire signals pipeline is live and 100% covered: the producer (enqueueSignalJob) is called
 * from the collect path, QueueDispatcher is instantiated in src/index.ts, and the rule-eval
 * (src/signals/indicators.ts) now gates emission. Nothing under src/signals is coverage-excluded.
 *
 * This file freezes the contract regardless of coverage: static assertions that the wire shape
 * (SignalJob) and the dispatcher port have not drifted, so the compiler (and CI) fail the moment
 * they do. No runtime, no mocks — the invariants are "verified another way".
 */
import type { QueueDispatcher } from '../adapters/signals/queue-dispatcher';
import type { SignalDispatcher } from '../domain/ports';
import type { Mover, SignalJob } from './types';

/** Static assertion: a compile error unless `A` is assignable to `B`. */
type Extends<A extends B, B> = A;

/** The production dispatcher must remain a {@link SignalDispatcher}. */
export type DispatcherHonoursPort = Extends<QueueDispatcher, SignalDispatcher>;

/**
 * The frozen wire shape (schemaVersion 2): one batched job per tick (keeps queue ops tiny — see
 * types.ts), each mover carrying direction/percent/price detail. Asserted EXACTLY: the key SETS must
 * match (an extra, optional, or missing key fails typecheck — assignability alone would let an optional
 * field slip through), AND the shared field types must be mutually assignable (a changed field type
 * fails too). Both the job AND the nested mover shape are frozen.
 */
type FrozenMover = { symbol: string; changeBp: number; priceMinor: number; scale: number };
type FrozenJob = { bucketTs: number; movers: FrozenMover[]; producedAt: number; schemaVersion: 2 };
export type JobNoExtraKeys = Extends<Exclude<keyof SignalJob, keyof FrozenJob>, never>;
export type JobNoMissingKeys = Extends<Exclude<keyof FrozenJob, keyof SignalJob>, never>;
export type JobFieldTypesMatch = Extends<SignalJob, FrozenJob> & Extends<FrozenJob, SignalJob>;
export type MoverNoExtraKeys = Extends<Exclude<keyof Mover, keyof FrozenMover>, never>;
export type MoverNoMissingKeys = Extends<Exclude<keyof FrozenMover, keyof Mover>, never>;
export type MoverFieldTypesMatch = Extends<Mover, FrozenMover> & Extends<FrozenMover, Mover>;
