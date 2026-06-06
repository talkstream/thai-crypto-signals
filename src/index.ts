import { BitkubAdapter } from './adapters/bitkub/client';
import { AnalyticsEngineSink } from './adapters/observability/metrics';
import { SystemClock, SystemRng } from './adapters/runtime';
import { KvCacheWriter } from './adapters/storage/cache-writer';
import { D1CollectStore } from './adapters/storage/collect-store';
import { D1ReadStore } from './adapters/storage/read-store';
import { D1SymbolStore } from './adapters/storage/symbol-store';
import { handleRequest } from './api/router';
import { collect } from './collector/collect';
import { maintenance } from './collector/maintenance';
import { rollup } from './collector/rollup-job';
import { cronExprFor } from './config/cadence';
import { consumeSignals } from './signals/consumer';

const ROLLUP_CRON = '17 * * * *';
const MAINTENANCE_CRON = '7 3 * * *';
const RUNS_RETENTION_DAYS = 30;
const ROLLUPS_1H_RETENTION_DAYS = 90;

function bitkub(env: Env, clock: SystemClock): BitkubAdapter {
  return new BitkubAdapter({
    baseUrl: env.BITKUB_BASE_URL,
    timeoutMs: Number(env.TICKER_TIMEOUT_MS),
    clock,
    rng: new SystemRng(),
  });
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const clock = new SystemClock();
    const obs = new AnalyticsEngineSink(env.METRICS);
    const cadence = Number(env.COLLECT_CADENCE_MINUTES);
    const collectCron = cronExprFor(cadence); // throws loudly on a misconfigured (non-60-divisor) cadence

    if (controller.cron === ROLLUP_CRON) {
      await rollup({ db: env.DB, obs, clock, maxWindows: Number(env.ROLLUP_MAX_WINDOWS) });
      return;
    }
    if (controller.cron === MAINTENANCE_CRON) {
      await maintenance({
        db: env.DB,
        marketData: bitkub(env, clock),
        symbols: new D1SymbolStore(env.DB),
        obs,
        clock,
        retentionDays: Number(env.RAW_RETENTION_DAYS),
        runsRetentionDays: RUNS_RETENTION_DAYS,
        rollups1hRetentionDays: ROLLUPS_1H_RETENTION_DAYS,
      });
      return;
    }
    if (controller.cron === collectCron) {
      await collect({
        marketData: bitkub(env, clock),
        symbols: new D1SymbolStore(env.DB),
        store: new D1CollectStore(env.DB),
        cache: new KvCacheWriter(env.CACHE),
        obs,
        clock,
        cadenceMinutes: cadence,
      });
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const cadence = Number(env.COLLECT_CADENCE_MINUTES);
    return handleRequest(req, {
      store: new D1ReadStore(env.DB),
      cache: env.CACHE,
      clock: new SystemClock(),
      freshMs: cadence * 60_000 * 3,
    });
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    consumeSignals(batch.messages, new AnalyticsEngineSink(env.METRICS));
  },
};
