import { describe, expect, it } from 'vitest';
import { consumeSignals } from '../../src/signals/consumer';
import { InMemoryObservabilitySink } from '../helpers/fakes';

// The signals CONSUMER is live production wiring (the worker's queue() handler calls it), so it is
// covered for real — no mock, no cast: AckableMessage is a plain interface, so the test builds plain
// objects. (The producer side is dormant phase-2 and excluded from coverage; see vitest.config.ts.)
describe('consumeSignals (live queue consumer — ack-and-drop, zero delivery)', () => {
  it('acks every message and flags only invalid bodies', () => {
    const obs = new InMemoryObservabilitySink();
    let acked = 0;
    const ack = () => {
      acked += 1;
    };
    consumeSignals(
      [
        { body: { bucketTs: 1, symbols: ['BTC_THB'], producedAt: 2, schemaVersion: 1 }, ack }, // valid
        { body: { not: 'a job' }, ack }, // invalid -> surfaced
      ],
      obs,
    );

    expect(acked).toBe(2); // every message is acked, valid or not
    expect(obs.events.filter((e) => e.kind === 'signal_invalid').length).toBe(1); // only the invalid one
  });

  it('does nothing on an empty batch', () => {
    const obs = new InMemoryObservabilitySink();
    consumeSignals([], obs);
    expect(obs.events.length).toBe(0);
  });
});
