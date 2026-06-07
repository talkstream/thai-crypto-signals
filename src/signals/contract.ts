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
import type { SignalJob } from './types';

/** Static assertion: a compile error unless `A` is assignable to `B`. */
type Extends<A extends B, B> = A;

/** The production dispatcher must remain a {@link SignalDispatcher}. */
export type DispatcherHonoursPort = Extends<QueueDispatcher, SignalDispatcher>;

/**
 * The frozen wire shape: one batched job per tick (keeps queue ops tiny — see types.ts). Asserted
 * EXACTLY: the key SETS must match (an extra, optional, or missing key fails typecheck — assignability
 * alone would let an optional field slip through), AND the shared field types must be mutually
 * assignable (a changed field type fails too).
 */
type FrozenJob = { bucketTs: number; symbols: string[]; producedAt: number; schemaVersion: 1 };
export type JobNoExtraKeys = Extends<Exclude<keyof SignalJob, keyof FrozenJob>, never>;
export type JobNoMissingKeys = Extends<Exclude<keyof FrozenJob, keyof SignalJob>, never>;
export type JobFieldTypesMatch = Extends<SignalJob, FrozenJob> & Extends<FrozenJob, SignalJob>;
