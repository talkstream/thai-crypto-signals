import { RATE_LIMIT_BLOCK_MS } from '../../config/constants';
import {
  BitkubHttpError,
  BitkubRateLimitedError,
  BitkubTimeoutError,
  BitkubUnreachableError,
} from '../../domain/errors';
import type { Clock, Fetcher, MarketDataSource, Rng } from '../../domain/ports';
import type { CatalogEntry } from '../../domain/types';
import { parseServerTime, parseSymbols, parseTickerEnvelope } from './schemas';

const USER_AGENT = 'thai-crypto-signals/0.1 (+https://github.com/talkstream/thai-crypto-signals)';
const RETRY_BASE_MS = 500;
const RETRY_JITTER_MS = 500;

export interface BitkubAdapterOptions {
  baseUrl: string;
  timeoutMs: number;
  clock: Clock;
  rng: Rng;
  /** Network edge (a port). Prod passes globalThis.fetch; tests pass a recorded-response fetcher. */
  fetcher: Fetcher;
}

/**
 * The ONE external HTTP boundary. Polite User-Agent, injectable timeout, one retry on
 * 5xx/network errors (with jittered backoff), no retry on 429 (rate limited) or timeout.
 * The network call goes through the injected {@link Fetcher} — production wires globalThis.fetch,
 * tests wire a fetcher that replays recorded real responses (contract replay; no global patching).
 */
export class BitkubAdapter implements MarketDataSource {
  constructor(private readonly opts: BitkubAdapterOptions) {}

  private async backoff(): Promise<void> {
    await this.opts.clock.sleep(RETRY_BASE_MS + this.opts.rng.nextUnit() * RETRY_JITTER_MS);
  }

  private async fetchJson(path: string): Promise<unknown> {
    const url = `${this.opts.baseUrl}${path}`;
    let attempt = 0;
    for (;;) {
      try {
        const res = await this.opts.fetcher(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        if (res.status === 429) throw new BitkubRateLimitedError(RATE_LIMIT_BLOCK_MS);
        if (res.status >= 500) {
          if (attempt === 0) {
            attempt = 1;
            await this.backoff();
            continue;
          }
          throw new BitkubHttpError(res.status);
        }
        if (!res.ok) throw new BitkubHttpError(res.status);
        return await res.json();
      } catch (e) {
        if (e instanceof BitkubRateLimitedError || e instanceof BitkubHttpError) throw e;
        if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
          throw new BitkubTimeoutError(e.name);
        }
        if (attempt === 0) {
          attempt = 1;
          await this.backoff();
          continue;
        }
        throw new BitkubUnreachableError(e);
      }
    }
  }

  async getServerTime(): Promise<number> {
    return parseServerTime(await this.fetchJson('/api/v3/servertime'));
  }

  async getTicker(): Promise<unknown[]> {
    return parseTickerEnvelope(await this.fetchJson('/api/v3/market/ticker'));
  }

  async getSymbols(): Promise<CatalogEntry[]> {
    return parseSymbols(await this.fetchJson('/api/v3/market/symbols'));
  }
}
