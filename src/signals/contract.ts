/**
 * Compile-time contract for the DORMANT phase-2 signals subsystem.
 *
 * Signals (producer, dispatcher, consumer, indicators, notifier) are a frozen phase-2 scaffold that
 * never runs in production: no producer is wired into the collect path and nothing is ever delivered.
 * Rather than exercise dead code with fakes, the subsystem is carved out of COVERAGE
 * (vitest.config.ts) — but it is still fully TYPE-CHECKED by `tsgo --noEmit` on every build (the
 * typecheck excludes nothing). This file makes that guarantee explicit: it is a static assertion that
 * the scaffold still honours its frozen ports, so the compiler (and CI) fail the moment it drifts.
 * No runtime, no mocks — this is how the mini-scope is "verified another way".
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
 * EXACTLY in BOTH directions, so a missing, changed, OR extra field on SignalJob fails typecheck.
 */
type FrozenJob = { bucketTs: number; symbols: string[]; producedAt: number; schemaVersion: 1 };
export type JobHasNoExtraFields = Extends<SignalJob, FrozenJob>;
export type JobHasEveryField = Extends<FrozenJob, SignalJob>;
