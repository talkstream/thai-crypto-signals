/**
 * Compile-time contract for the signals wire shape and dispatcher port.
 *
 * Phase 2 wired the producer side live: the producer (enqueueSignalJob) is called from the collect
 * path and QueueDispatcher is instantiated in src/index.ts — both are now IN coverage and tested.
 * The only still-dormant piece is the rule-eval scaffold (src/signals/indicators.ts), a later
 * sub-phase carved out of COVERAGE but still fully TYPE-CHECKED by `tsgo --noEmit` (the typecheck
 * excludes nothing).
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
