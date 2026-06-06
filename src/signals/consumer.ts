import { z } from 'zod';
import { safeEvent } from '../domain/obs';
import type { ObservabilitySink } from '../domain/ports';

const SignalJobSchema = z.object({
  bucketTs: z.number(),
  symbols: z.array(z.string()),
  producedAt: z.number(),
  schemaVersion: z.literal(1),
});

export interface AckableMessage {
  body: unknown;
  ack(): void;
}

/**
 * DARK consumer: validates each message and acks it (valid or invalid) — ack-and-drop, zero
 * delivery. Invalid bodies are surfaced via observability. Phase 2 will add real delivery.
 */
export function consumeSignals(messages: AckableMessage[], obs: ObservabilitySink): void {
  for (const message of messages) {
    if (!SignalJobSchema.safeParse(message.body).success) {
      safeEvent(obs, 'signal_invalid', {}, { count: 1 });
    }
    message.ack();
  }
}
