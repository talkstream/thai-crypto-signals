import type { SymbolStore } from '../../domain/ports';
import type { CatalogEntry, MarketSymbol, SymbolMap } from '../../domain/types';

interface SymbolRow {
  id: number;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  price_scale: number;
  quote_scale: number;
  market_segment: string;
  status: string;
}

const SELECT_ALL =
  'SELECT id, symbol, base_asset, quote_asset, price_scale, quote_scale, market_segment, status FROM symbols';

const UPSERT = `INSERT INTO symbols
  (symbol, base_asset, quote_asset, price_scale, quote_scale, market_segment, status, first_seen_ms, last_seen_ms)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(symbol) DO UPDATE SET
    base_asset = excluded.base_asset,
    quote_asset = excluded.quote_asset,
    price_scale = excluded.price_scale,
    quote_scale = excluded.quote_scale,
    market_segment = excluded.market_segment,
    status = excluded.status,
    last_seen_ms = excluded.last_seen_ms`;

export class D1SymbolStore implements SymbolStore {
  constructor(private readonly db: D1Database) {}

  async loadMap(): Promise<SymbolMap> {
    const { results } = await this.db.prepare(SELECT_ALL).all<SymbolRow>();
    const map = new Map<string, MarketSymbol>();
    for (const r of results) {
      map.set(r.symbol, {
        id: r.id,
        symbol: r.symbol,
        baseAsset: r.base_asset,
        quoteAsset: r.quote_asset,
        priceScale: r.price_scale,
        quoteScale: r.quote_scale,
        marketSegment: r.market_segment,
        status: r.status,
      });
    }
    return map;
  }

  async upsertMany(entries: CatalogEntry[], nowMs: number): Promise<void> {
    if (entries.length === 0) return;
    const stmt = this.db.prepare(UPSERT);
    const batch = entries.map((e) =>
      stmt.bind(
        e.symbol,
        e.baseAsset,
        e.quoteAsset,
        e.priceScale,
        e.quoteScale,
        e.marketSegment,
        e.status,
        nowMs,
        nowMs,
      ),
    );
    await this.db.batch(batch);
  }
}
