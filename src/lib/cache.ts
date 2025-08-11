// Simple in-memory TTL cache suitable for serverless functions and node runtimes
// Not distributed; survives per-process only

export type CacheEntry<V> = { value: V; expiresAt: number };

export class TtlCache<K, V> {
  private store = new Map<string, CacheEntry<V>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  private toKey(key: K): string {
    return typeof key === 'string' ? key : JSON.stringify(key);
  }

  get(key: K): V | undefined {
    const k = this.toKey(key);
    const entry = this.store.get(k);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(k);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    const k = this.toKey(key);
    this.store.set(k, { value, expiresAt: Date.now() + this.ttlMs });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): void {
    const k = this.toKey(key);
    this.store.delete(k);
  }

  clear(): void {
    this.store.clear();
  }
}


