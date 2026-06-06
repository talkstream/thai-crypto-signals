import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { resetDb } from '../helpers/migrate';

const db = env.DB;
const SERVER_MS = 1_700_000_040_000;

beforeEach(async () => {
  await resetDb(db);
  await env.CACHE.delete('latest:v1');
});
afterEach(() => {
  vi.restoreAllMocks();
});

function routeAll() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/servertime')) return Promise.resolve(Response.json(SERVER_MS));
    if (url.includes('/market/symbols')) {
      return Promise.resolve(
        Response.json({
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
        }),
      );
    }
    if (url.includes('/market/ticker')) {
      return Promise.resolve(
        Response.json([
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
        ]),
      );
    }
    throw new Error(`unexpected ${url}`);
  });
}

const ctrl = (cron: string): ScheduledController =>
  ({ cron, scheduledTime: SERVER_MS, noRetry() {} }) as ScheduledController;

describe('worker scheduled dispatch', () => {
  it('runs the collect tick on the collect cron', async () => {
    routeAll();
    await worker.scheduled(ctrl('*/2 * * * *'), env);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM ticker_snapshots').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('runs maintenance on the daily cron', async () => {
    routeAll();
    await worker.scheduled(ctrl('7 3 * * *'), env);
    const cat = await db
      .prepare("SELECT status FROM collection_runs WHERE kind = 'catalog'")
      .first<{ status: string }>();
    expect(cat?.status).toBe('ok');
  });

  it('runs the rollup job on the hourly cron without error', async () => {
    await expect(worker.scheduled(ctrl('17 * * * *'), env)).resolves.toBeUndefined();
  });

  it('no-ops on an unknown cron', async () => {
    await expect(worker.scheduled(ctrl('0 0 * * *'), env)).resolves.toBeUndefined();
  });
});

describe('worker fetch + queue', () => {
  it('serves /health', async () => {
    const res = await worker.fetch(new Request('https://x/health'), env);
    expect(res.status).toBe(200);
  });

  it('drains the dark queue without delivering', async () => {
    let acked = 0;
    const batch = {
      messages: [
        {
          body: { bucketTs: 1, symbols: ['BTC_THB'], producedAt: 2, schemaVersion: 1 },
          ack() {
            acked += 1;
          },
        },
      ],
    } as unknown as MessageBatch<unknown>;
    await worker.queue(batch, env);
    expect(acked).toBe(1);
  });
});
