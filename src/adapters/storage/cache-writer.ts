import type { CacheWriter } from '../../domain/ports';

/** Production CacheWriter wrapping a KV namespace. Non-authoritative hot cache. */
export class KvCacheWriter implements CacheWriter {
  constructor(private readonly kv: KVNamespace) {}
  async put(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.kv.put(key, value, ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
  }
}
