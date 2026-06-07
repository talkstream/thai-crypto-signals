/**
 * Compile-time contract for the DORMANT producer-side signals scaffold.
 *
 * The producer side (producer, dispatcher/adapter, indicators, notifier) is a frozen phase-2 scaffold
 * with ZERO runtime callers — nothing is ever delivered. Rather than exercise dead code with fakes,
 * it is carved out of COVERAGE (vitest.config.ts) — but still fully TYPE-CHECKED by `tsgo --noEmit`
 * on every build (the typecheck excludes nothing). This file makes that guarantee explicit: static
 * assertions that the scaffold still honours its frozen ports, so the compiler (and CI) fail the
 * moment it drifts. No runtime, no mocks — the dead scaffold is "verified another way".
 *
 * The CONSUMER (src/signals/consumer.ts) is the live-but-dark exception: it IS wired into the
 * worker's queue() handler, kept IN coverage, and tested in test/unit/signals-consumer.test.ts.
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
