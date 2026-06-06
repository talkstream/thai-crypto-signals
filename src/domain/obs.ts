import type { ObsBlobs, ObsDoubles, ObservabilitySink } from './ports';

/** Write an Analytics Engine event, swallowing failures (metrics are never on the hot path). */
export function safeEvent(
  obs: ObservabilitySink,
  kind: string,
  blobs: ObsBlobs,
  doubles: ObsDoubles,
): void {
  try {
    obs.writeEvent(kind, blobs, doubles);
  } catch {
    // best-effort
  }
}

export const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
