import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { FakeClock, FakeRng } from '../helpers/fakes';

function adapter(timeoutMs = 8000): BitkubAdapter {
  return new BitkubAdapter({
    baseUrl: 'https://api.bitkub.com',
    timeoutMs,
    clock: new FakeClock(0),
    rng: new FakeRng(0.5),
  });
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) =>
      Promise.resolve(handler(String(input), init as RequestInit | undefined)),
    );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BitkubAdapter happy paths', () => {
  it('getServerTime coerces a numeric body and sends a polite User-Agent', async () => {
    let seenUa: string | null = null;
    mockFetch((_url, init) => {
      seenUa = new Headers(init?.headers).get('user-agent');
      return Response.json(1780745575377);
    });
    expect(await adapter().getServerTime()).toBe(1780745575377);
    expect(seenUa).toContain('thai-crypto-signals');
  });

  it('getTicker returns the recorded array', async () => {
    mockFetch(() => Response.json(tickerReal));
    expect((await adapter().getTicker()).length).toBe(441);
  });

  it('getSymbols returns the recorded catalog', async () => {
    mockFetch(() => Response.json(symbolsReal));
    expect((await adapter().getSymbols()).length).toBe(454);
  });
});

describe('BitkubAdapter error handling', () => {
  it('429 -> BitkubRateLimitedError with no retry', async () => {
    const spy = mockFetch(() => new Response('rate limited', { status: 429 }));
    await expect(adapter().getServerTime()).rejects.toBeInstanceOf(BitkubRateLimitedError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('5xx then 200 -> one retry then success', async () => {
    let n = 0;
    const spy = mockFetch(() => {
      n += 1;
      return n === 1 ? new Response('boom', { status: 503 }) : Response.json(1);
    });
    expect(await adapter().getServerTime()).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('5xx twice -> BitkubHttpError', async () => {
    const spy = mockFetch(() => new Response('boom', { status: 502 }));
    await expect(adapter().getServerTime()).rejects.toBeInstanceOf(BitkubHttpError);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('4xx -> BitkubHttpError with no retry', async () => {
    const spy = mockFetch(() => new Response('nope', { status: 404 }));
    await expect(adapter().getServerTime()).rejects.toBeInstanceOf(BitkubHttpError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('network error then 200 -> one retry then success', async () => {
    let n = 0;
    const spy = mockFetch(() => {
      n += 1;
      if (n === 1) throw new TypeError('network down');
      return Response.json(1);
    });
    expect(await adapter().getServerTime()).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('network error twice -> BitkubUnreachableError', async () => {
    const spy = mockFetch(() => {
      throw new TypeError('network down');
    });
    await expect(adapter().getServerTime()).rejects.toBeInstanceOf(BitkubUnreachableError);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('timeout -> BitkubTimeoutError running the real AbortSignal.timeout path', async () => {
    mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject((init.signal as AbortSignal).reason),
          );
        }),
    );
    const err = await adapter(1)
      .getServerTime()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BitkubTimeoutError);
    expect((err as BitkubTimeoutError).observedName).toMatch(/TimeoutError|AbortError/);
  });

  it('a malformed envelope is a PayloadValidationError and is not retried', async () => {
    const spy = mockFetch(() => Response.json({ error: 3 }));
    await expect(adapter().getTicker()).rejects.toBeInstanceOf(PayloadValidationError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
