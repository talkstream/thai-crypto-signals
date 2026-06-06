import { describe, expect, it } from 'vitest';
import { AnalyticsEngineSink } from '../../src/adapters/observability/metrics';

describe('AnalyticsEngineSink', () => {
  it('writes run + event data points to the dataset', () => {
    const points: unknown[] = [];
    const dataset = {
      writeDataPoint: (p: unknown) => points.push(p),
    } as unknown as AnalyticsEngineDataset;
    const sink = new AnalyticsEngineSink(dataset);
    sink.writeRun({ status: 'ok' }, { rows: 2 });
    sink.writeEvent('overlap', { bucket: '1' }, { count: 1 });
    expect(points.length).toBe(2);
  });

  it('tolerates an undefined dataset (local/test)', () => {
    const sink = new AnalyticsEngineSink(undefined);
    expect(() => sink.writeRun({}, {})).not.toThrow();
    expect(() => sink.writeEvent('x', {}, {})).not.toThrow();
  });
});
