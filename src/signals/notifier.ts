import { safeEvent } from '../domain/obs';
import type { ObservabilitySink } from '../domain/ports';
import type { SignalJob } from './types';

export interface Notifier {
  deliver(job: SignalJob): Promise<{ ok: boolean; skipped: boolean }>;
}

/** DARK: logs intent via observability and never delivers anywhere. */
export class NoopNotifier implements Notifier {
  constructor(private readonly obs: ObservabilitySink) {}
  async deliver(job: SignalJob): Promise<{ ok: boolean; skipped: boolean }> {
    safeEvent(
      this.obs,
      'notify_skipped',
      { schema: String(job.schemaVersion) },
      {
        symbols: job.symbols.length,
      },
    );
    return { ok: true, skipped: true };
  }
}
