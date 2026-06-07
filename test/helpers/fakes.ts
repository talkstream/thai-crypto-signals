// Test doubles — strictly at the system's EDGES, never of our own logic. There is no `vi.mock`/
// `vi.spyOn` anywhere in the suite: our code always runs for real (against real local D1+KV via
// Miniflare). What is injected here are ports for things a test cannot run authentically:
//   - the network edge (recordingFetcher) — replays recorded real Bitkub responses (contract replay);
//   - non-determinism (FakeClock/FakeRng) — fixed time/jitter (the CI-guarded no-wall-clock rule);
//   - platform telemetry / cache (InMemoryObservabilitySink/InMemoryCacheWriter) — the Analytics
//     Engine binding has no test-runtime API, and these can be told to throw to cover the
//     best-effort swallow branches.

import type {
  CacheWriter,
  Clock,
  Fetcher,
  ObsBlobs,
  ObsDoubles,
  ObservabilitySink,
  Rng,
} from '../../src/domain/ports';

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
  async put(key: string, value: string, _ttlSeconds?: number): Promise<void> {
    if (this.throwOnPut) throw new Error('KV unavailable');
    this.store.set(key, value);
  }
}

/**
 * The network edge as an injected {@link Fetcher} — the seam that replaces `globalThis.fetch` with
 * RECORDED real Bitkub responses (contract replay), so no test ever patches a global or mocks a
 * module. `handler` maps a request URL/init to a Response; `.calls` counts invocations (for the
 * retry/no-retry assertions the old `vi.spyOn(...).toHaveBeenCalledTimes` made).
 */
export function recordingFetcher(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetcher: Fetcher; readonly calls: number } {
  let n = 0;
  const fetcher: Fetcher = (input, init) => {
    n += 1;
    return Promise.resolve(handler(String(input), init as RequestInit | undefined));
  };
  return {
    fetcher,
    get calls() {
      return n;
    },
  };
}
