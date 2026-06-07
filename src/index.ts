import { BitkubAdapter } from './adapters/bitkub/client';
import { AnalyticsEngineSink } from './adapters/observability/metrics';
import { SystemClock, SystemRng } from './adapters/runtime';
import { QueueDispatcher } from './adapters/signals/queue-dispatcher';
import { KvCacheWriter } from './adapters/storage/cache-writer';
import { D1CollectStore } from './adapters/storage/collect-store';
import { D1ReadStore } from './adapters/storage/read-store';
import { D1SymbolStore } from './adapters/storage/symbol-store';
import { handleRequest } from './api/router';
import { collect } from './collector/collect';
import { maintenance } from './collector/maintenance';
import { rollup } from './collector/rollup-job';
import { cronExprFor } from './config/cadence';
import type { Fetcher } from './domain/ports';
import { consumeSignals } from './signals/consumer';
import { FanOutNotifier } from './signals/notifiers/fan-out';
import { LineNotifier } from './signals/notifiers/line';
import { TelegramNotifier } from './signals/notifiers/telegram';
import { WebhookNotifier } from './signals/notifiers/webhook';

const ROLLUP_CRON = '17 * * * *';
const MAINTENANCE_CRON = '7 3 * * *';
const RUNS_RETENTION_DAYS = 30;
const ROLLUPS_1H_RETENTION_DAYS = 90;

/**
 * Injectable worker wiring. The network edge is a port (see {@link Fetcher}): production wires
 * `globalThis.fetch`, tests inject a fetcher that replays recorded real responses (contract replay),
 * so the worker can be exercised end-to-end WITHOUT patching any global or mocking any module.
 */
export interface WorkerWiring {
  fetcher: Fetcher;
}

function bitkub(env: Env, clock: SystemClock, fetcher: Fetcher): BitkubAdapter {
  return new BitkubAdapter({
    baseUrl: env.BITKUB_BASE_URL,
    timeoutMs: Number(env.TICKER_TIMEOUT_MS),
    clock,
    rng: new SystemRng(),
    fetcher,
  });
}

/** Build the worker's handlers from injectable wiring. `export default makeWorker(...)` wires prod. */
export function makeWorker(wiring: WorkerWiring) {
  return {
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
          marketData: bitkub(env, clock, wiring.fetcher),
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
          marketData: bitkub(env, clock, wiring.fetcher),
          symbols: new D1SymbolStore(env.DB),
          store: new D1CollectStore(env.DB),
          cache: new KvCacheWriter(env.CACHE),
          obs,
          clock,
          cadenceMinutes: cadence,
          dispatcher: new QueueDispatcher(env.SIGNALS_QUEUE),
          signalsEnabled: String(env.SIGNALS_ENABLED) === 'true',
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

    /* istanbul ignore next -- thin platform glue: builds the channel notifiers from env secrets (a
       channel is active only when its secret(s) are present) and the call-time `wiring.fetcher`, then
       delegates to consumeSignals, whose parse->deliver->ack/retry logic IS covered by
       test/unit/signals-consumer.test.ts. Ignored only because constructing a real MessageBatch and
       reading secret bindings needs the runtime; the notifier classes are covered by their own tests. */
    async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
      const obs = new AnalyticsEngineSink(env.METRICS);
      const telegram =
        env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
          ? { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }
          : undefined;
      const line =
        env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_TARGET_ID
          ? { channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN, targetId: env.LINE_TARGET_ID }
          : undefined;
      const webhook =
        env.WEBHOOK_URL && env.WEBHOOK_SIGNING_SECRET
          ? { url: env.WEBHOOK_URL, signingSecret: env.WEBHOOK_SIGNING_SECRET }
          : undefined;
      const notifier = new FanOutNotifier([
        new TelegramNotifier(wiring.fetcher, telegram, obs),
        new LineNotifier(wiring.fetcher, line),
        new WebhookNotifier(wiring.fetcher, webhook),
      ]);
      await consumeSignals(batch.messages, notifier, obs);
    },
  };
}

/* istanbul ignore next -- prod-only network wiring: resolve `fetch` at call time inside the handler
   so it uses the per-request context. A reference captured at module-init (globalThis.fetch) does
   NOT work for outbound subrequests in the Workers runtime. Verified by the deploy smoke test, not
   unit tests (which inject their own recorded-response fetcher). */
export default makeWorker({ fetcher: (input, init) => fetch(input, init) });
