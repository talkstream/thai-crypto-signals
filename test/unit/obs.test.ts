import { describe, expect, it } from 'vitest';
import { errMessage, safeEvent } from '../../src/domain/obs';
import type { ObservabilitySink } from '../../src/domain/ports';

describe('safeEvent', () => {
  it('forwards to the sink', () => {
    const seen: string[] = [];
    const sink: ObservabilitySink = {
      writeRun() {},
      writeEvent(kind) {
        seen.push(kind);
      },
    };
    safeEvent(sink, 'overlap', {}, {});
    expect(seen).toEqual(['overlap']);
  });

  it('swallows sink failures', () => {
    const sink: ObservabilitySink = {
      writeRun() {},
      writeEvent() {
        throw new Error('AE down');
      },
    };
    expect(() => safeEvent(sink, 'overlap', {}, {})).not.toThrow();
  });
});

describe('errMessage', () => {
  it('extracts Error messages and stringifies the rest', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
    expect(errMessage('plain')).toBe('plain');
  });
});
