import type {
  CacheWriter,
  Clock,
  ObsBlobs,
  ObsDoubles,
  ObservabilitySink,
  Rng,
  SignalDispatcher,
} from '../../src/domain/ports';
import type { SignalJob } from '../../src/signals/types';

/** Deterministic injected clock; records sleeps instead of waiting. */
export class FakeClock implements Clock {
  readonly sleeps: number[] = [];
  constructor(private t: number) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
  }
}

/** Deterministic injected randomness. */
export class FakeRng implements Rng {
  constructor(private readonly value = 0.5) {}
  nextUnit(): number {
    return this.value;
  }
}

/** In-memory ObservabilitySink; can be told to throw to cover best-effort swallow branches. */
export class InMemoryObservabilitySink implements ObservabilitySink {
  readonly runs: Array<{ blobs: ObsBlobs; doubles: ObsDoubles }> = [];
  readonly events: Array<{ kind: string; blobs: ObsBlobs; doubles: ObsDoubles }> = [];
  throwOnWrite = false;
  writeRun(blobs: ObsBlobs, doubles: ObsDoubles): void {
    if (this.throwOnWrite) throw new Error('AE unavailable');
    this.runs.push({ blobs, doubles });
  }
  writeEvent(kind: string, blobs: ObsBlobs, doubles: ObsDoubles): void {
    if (this.throwOnWrite) throw new Error('AE unavailable');
    this.events.push({ kind, blobs, doubles });
  }
}

/** In-memory CacheWriter; can be told to throw to cover the KV-swallow branch. */
export class InMemoryCacheWriter implements CacheWriter {
  readonly store = new Map<string, string>();
  throwOnPut = false;
  async put(key: string, value: string): Promise<void> {
    if (this.throwOnPut) throw new Error('KV unavailable');
    this.store.set(key, value);
  }
}

/** In-memory queue producer (DARK). Records jobs; never delivers anywhere. */
export class InMemorySignalDispatcher implements SignalDispatcher {
  readonly jobs: SignalJob[] = [];
  async enqueue(job: SignalJob): Promise<void> {
    this.jobs.push(job);
  }
}
