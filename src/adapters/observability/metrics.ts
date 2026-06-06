import type { ObsBlobs, ObsDoubles, ObservabilitySink } from '../../domain/ports';

/**
 * Analytics Engine sink. Tolerates an undefined binding (the dataset is absent locally and in
 * tests), so the worker wiring never throws on a metric write off the hot path.
 */
export class AnalyticsEngineSink implements ObservabilitySink {
  constructor(private readonly dataset: AnalyticsEngineDataset | undefined) {}

  writeRun(blobs: ObsBlobs, doubles: ObsDoubles): void {
    this.write('run', blobs, doubles);
  }

  writeEvent(kind: string, blobs: ObsBlobs, doubles: ObsDoubles): void {
    this.write(kind, blobs, doubles);
  }

  private write(kind: string, blobs: ObsBlobs, doubles: ObsDoubles): void {
    if (!this.dataset) return;
    this.dataset.writeDataPoint({
      indexes: [kind],
      blobs: [kind, ...Object.values(blobs)],
      doubles: Object.values(doubles),
    });
  }
}
