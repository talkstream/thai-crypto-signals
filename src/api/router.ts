import type { ReadStore } from '../adapters/storage/read-store';
import type { LatestDto } from '../domain/dto';
import { SymbolNotInCatalogError } from '../domain/errors';
import type { Clock } from '../domain/ports';

const LATEST_KEY = 'latest:v1';
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', ...CORS };

export interface ApiDeps {
  store: ReadStore;
  cache: KVNamespace;
  clock: Clock;
  freshMs: number;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const jsonRaw = (serialized: string): Response =>
  new Response(serialized, { status: 200, headers: JSON_HEADERS });

// Canonical serialization so a KV hit and a D1 rebuild are byte-identical (sorted, no writtenAtMs).
function serializeLatest(dto: LatestDto): string {
  const entries = [...dto.entries].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return JSON.stringify({ bucketTs: dto.bucketTs, entries });
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function latest(deps: ApiDeps): Promise<Response> {
  const cached = await deps.cache.get(LATEST_KEY);
  if (cached !== null) {
    try {
      return jsonRaw(serializeLatest(JSON.parse(cached) as LatestDto));
    } catch {
      // corrupt cache value — treat as a miss and rebuild from D1
    }
  }
  return jsonRaw(serializeLatest(await deps.store.latest()));
}

export async function handleRequest(req: Request, deps: ApiDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    if (path === '/health') {
      return json(await deps.store.health(deps.clock.now(), deps.freshMs));
    }
    if (path === '/v1/symbols') {
      return json({ symbols: await deps.store.listSymbols() });
    }
    if (path === '/v1/tickers/latest') {
      return await latest(deps);
    }
    const m = path.match(/^\/v1\/tickers\/([A-Za-z0-9_]+?)(\/rollups)?$/);
    if (m?.[1]) {
      const symbol = m[1];
      if (m[2]) {
        const interval = url.searchParams.get('interval') === '1d' ? '1d' : '1h';
        const limit = clampInt(url.searchParams.get('limit'), 168, 1, 1000);
        return json(await deps.store.rollups(symbol, interval, limit));
      }
      const to = clampInt(url.searchParams.get('to'), deps.clock.now(), 0, Number.MAX_SAFE_INTEGER);
      const from = clampInt(
        url.searchParams.get('from'),
        to - 86_400_000,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const limit = clampInt(url.searchParams.get('limit'), 500, 1, 5000);
      return json(await deps.store.history(symbol, from, to, limit));
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    if (e instanceof SymbolNotInCatalogError) return json({ error: 'symbol_not_found' }, 404);
    return json({ error: 'internal_error' }, 500);
  }
}
