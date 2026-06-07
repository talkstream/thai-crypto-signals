import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeWorker } from '../../src/index';
import { recordingFetcher } from '../helpers/fakes';
import { resetDb } from '../helpers/migrate';

const db = env.DB;
const SERVER_MS = 1_700_000_040_000;

beforeEach(async () => {
  await resetDb(db);
  await env.CACHE.delete('latest:v1');
});

// The network edge is INJECTED (contract replay), not patched: the worker is built with a fetcher
// that replays recorded responses — no vi.spyOn, no global mutation. (The dormant queue() consumer
// is intentionally not tested — see src/signals, a frozen type-checked phase-2 scaffold.)
function routedWorker() {
  const { fetcher } = recordingFetcher((url) => {
    if (url.includes('/servertime')) return Response.json(SERVER_MS);
    if (url.includes('/market/symbols')) {
      return Response.json({
        error: 0,
        result: [
          {
            symbol: 'BTC_THB',
            base_asset: 'BTC',
            quote_asset: 'THB',
            base_asset_scale: 8,
            price_scale: 2,
            quote_asset_scale: 2,
            market_segment: 'SPOT',
            status: 'active',
          },
        ],
      });
    }
    if (url.includes('/market/ticker')) {
      return Response.json([
        {
          symbol: 'BTC_THB',
          last: '2017050.88',
          high_24_hr: '2071651',
          low_24_hr: '1950000',
          highest_bid: '2017050.88',
          lowest_ask: '2017617.96',
          base_volume: '300',
          quote_volume: '6e8',
          percent_change: '-0.94',
        },
      ]);
    }
    throw new Error(`unexpected ${url}`);
  });
  return makeWorker({ fetcher });
}

const ctrl = (cron: string): ScheduledController =>
  ({ cron, scheduledTime: SERVER_MS, noRetry() {} }) as ScheduledController;

describe('worker scheduled dispatch', () => {
  it('runs the collect tick on the collect cron', async () => {
    await routedWorker().scheduled(ctrl('*/2 * * * *'), env);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM ticker_snapshots').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('runs maintenance on the daily cron', async () => {
    await routedWorker().scheduled(ctrl('7 3 * * *'), env);
    const cat = await db
      .prepare("SELECT status FROM collection_runs WHERE kind = 'catalog'")
      .first<{ status: string }>();
    expect(cat?.status).toBe('ok');
  });

  it('runs the rollup job on the hourly cron without error', async () => {
    await expect(routedWorker().scheduled(ctrl('17 * * * *'), env)).resolves.toBeUndefined();
  });

  it('no-ops on an unknown cron', async () => {
    await expect(routedWorker().scheduled(ctrl('0 0 * * *'), env)).resolves.toBeUndefined();
  });
});

describe('worker fetch', () => {
  it('serves /health', async () => {
    const res = await routedWorker().fetch(new Request('https://x/health'), env);
    expect(res.status).toBe(200);
  });
});

describe('worker queue (signals delivery)', () => {
  const JOB = { bucketTs: 1, symbols: ['BTC_THB'], producedAt: 2, schemaVersion: 1 };

  function oneMessageBatch(body: unknown) {
    const calls = { acked: 0, retried: 0 };
    const messages = [
      {
        body,
        attempts: 1,
        ack: () => {
          calls.acked += 1;
        },
        retry: () => {
          calls.retried += 1;
        },
      },
    ];
    return { batch: { messages } as unknown as MessageBatch<unknown>, calls };
  }

  // queue() reads only METRICS + the channel secrets + SIGNALS_ENABLED; a partial Env is enough.
  const envWith = (over: Record<string, string>): Env =>
    ({ METRICS: env.METRICS, ...over }) as unknown as Env;

  it('delivers via the secret-gated webhook channel when enabled, then acks', async () => {
    let hit: string | undefined;
    const { fetcher } = recordingFetcher((url) => {
      hit = url;
      return Response.json({});
    });
    const b = oneMessageBatch(JOB);
    await makeWorker({ fetcher }).queue(
      b.batch,
      envWith({
        SIGNALS_ENABLED: 'true',
        WEBHOOK_URL: 'https://hook.test/x',
        WEBHOOK_SIGNING_SECRET: 'sek',
      }),
    );
    expect(hit).toBe('https://hook.test/x');
    expect(b.calls.acked).toBe(1);
    expect(b.calls.retried).toBe(0);
  });

  it('drops without delivering when disabled (true kill switch)', async () => {
    const f = recordingFetcher(() => Response.json({}));
    const b = oneMessageBatch(JOB);
    await makeWorker({ fetcher: f.fetcher }).queue(
      b.batch,
      envWith({
        SIGNALS_ENABLED: 'false',
        WEBHOOK_URL: 'https://hook.test/x',
        WEBHOOK_SIGNING_SECRET: 'sek',
      }),
    );
    expect(f.calls).toBe(0); // no outbound delivery
    expect(b.calls.acked).toBe(1); // message dropped (acked), not retried
  });
});
