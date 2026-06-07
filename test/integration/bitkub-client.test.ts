import { describe, expect, it } from 'vitest';
import symbolsReal from '../../src/adapters/bitkub/cassettes/symbols.json';
import tickerReal from '../../src/adapters/bitkub/cassettes/ticker.json';
import { BitkubAdapter } from '../../src/adapters/bitkub/client';
import {
  BitkubHttpError,
  BitkubRateLimitedError,
  BitkubTimeoutError,
  BitkubUnreachableError,
  PayloadValidationError,
} from '../../src/domain/errors';
import type { Fetcher } from '../../src/domain/ports';
import { FakeClock, FakeRng, recordingFetcher } from '../helpers/fakes';

// No vi.spyOn / vi.mock: the network edge is injected as a Fetcher that replays recorded responses
// (contract replay). `recordingFetcher` also counts calls — the retry/no-retry assertions read that.
function adapter(fetcher: Fetcher, timeoutMs = 8000): BitkubAdapter {
  return new BitkubAdapter({
    baseUrl: 'https://api.bitkub.com',
    timeoutMs,
    clock: new FakeClock(0),
    rng: new FakeRng(0.5),
    fetcher,
  });
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

describe('BitkubAdapter happy paths', () => {
  it('getServerTime coerces a numeric body and sends a polite User-Agent', async () => {
    let seenUa: string | null = null;
    const f = recordingFetcher((_url, init) => {
      seenUa = new Headers(init?.headers).get('user-agent');
      return Response.json(1780745575377);
    });
    expect(await adapter(f.fetcher).getServerTime()).toBe(1780745575377);
    expect(seenUa).toContain('thai-crypto-signals');
  });

  it('getTicker returns the recorded array', async () => {
    const f = recordingFetcher(() => Response.json(tickerReal));
    expect((await adapter(f.fetcher).getTicker()).length).toBe(441);
  });

  it('getSymbols returns the recorded catalog', async () => {
    const f = recordingFetcher(() => Response.json(symbolsReal));
    expect((await adapter(f.fetcher).getSymbols()).length).toBe(454);
  });
});

describe('BitkubAdapter error handling', () => {
  it('429 -> BitkubRateLimitedError with no retry', async () => {
    const f = recordingFetcher(() => new Response('rate limited', { status: 429 }));
    await expect(adapter(f.fetcher).getServerTime()).rejects.toBeInstanceOf(BitkubRateLimitedError);
    expect(f.calls).toBe(1);
  });

  it('5xx then 200 -> one retry then success', async () => {
    let n = 0;
    const f = recordingFetcher(() => {
      n += 1;
      return n === 1 ? new Response('boom', { status: 503 }) : Response.json(1780745575377);
    });
    expect(await adapter(f.fetcher).getServerTime()).toBe(1780745575377);
    expect(f.calls).toBe(2);
  });

  it('5xx twice -> BitkubHttpError', async () => {
    const f = recordingFetcher(() => new Response('boom', { status: 502 }));
    await expect(adapter(f.fetcher).getServerTime()).rejects.toBeInstanceOf(BitkubHttpError);
    expect(f.calls).toBe(2);
  });

  it('4xx -> BitkubHttpError with no retry', async () => {
    const f = recordingFetcher(() => new Response('nope', { status: 404 }));
    await expect(adapter(f.fetcher).getServerTime()).rejects.toBeInstanceOf(BitkubHttpError);
    expect(f.calls).toBe(1);
  });

  it('network error then 200 -> one retry then success', async () => {
    let n = 0;
    const f = recordingFetcher(() => {
      n += 1;
      if (n === 1) throw new TypeError('network down');
      return Response.json(1780745575377);
    });
    expect(await adapter(f.fetcher).getServerTime()).toBe(1780745575377);
    expect(f.calls).toBe(2);
  });

  it('network error twice -> BitkubUnreachableError', async () => {
    const f = recordingFetcher(() => {
      throw new TypeError('network down');
    });
    await expect(adapter(f.fetcher).getServerTime()).rejects.toBeInstanceOf(BitkubUnreachableError);
    expect(f.calls).toBe(2);
  });

  it('timeout -> BitkubTimeoutError running the real AbortSignal.timeout path', async () => {
    const handler: Handler = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject((init.signal as AbortSignal).reason));
      });
    const f = recordingFetcher(handler);
    const err = await adapter(f.fetcher, 1)
      .getServerTime()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BitkubTimeoutError);
    expect((err as BitkubTimeoutError).observedName).toMatch(/TimeoutError|AbortError/);
  });

  it('a malformed envelope is a PayloadValidationError and is not retried', async () => {
    const f = recordingFetcher(() => Response.json({ error: 3 }));
    await expect(adapter(f.fetcher).getTicker()).rejects.toBeInstanceOf(PayloadValidationError);
    expect(f.calls).toBe(1);
  });

  it('maps a DOMException AbortError to BitkubTimeoutError', async () => {
    const f = recordingFetcher(() => {
      throw new DOMException('aborted', 'AbortError');
    });
    const err = await adapter(f.fetcher)
      .getServerTime()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BitkubTimeoutError);
    expect((err as BitkubTimeoutError).observedName).toBe('AbortError');
  });
});
