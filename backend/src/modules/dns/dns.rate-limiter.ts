export interface IRateLimiter {
  acquire(key: string): Promise<void>;
}

/**
 * Per-key token-bucket rate limiter.
 *
 * Each key has its own bucket. `acquire(key)` resolves immediately when the
 * bucket has a token; otherwise it sleeps just long enough for one token to
 * refill. The bucket is capped at `capacity`.
 *
 * `now` is injectable so tests can drive time without real timers.
 * The default sleeper uses `setTimeout`; tests can pass a fake.
 */
export class TokenBucketRateLimiter implements IRateLimiter {
  private state = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    if (capacity <= 0) throw new Error('capacity must be > 0');
    if (refillPerSec <= 0) throw new Error('refillPerSec must be > 0');
  }

  async acquire(key: string): Promise<void> {
    while (true) {
      const t = this.refill(key);
      if (t >= 1) {
        const cur = this.state.get(key)!;
        cur.tokens = t - 1;
        return;
      }
      const needed = 1 - t;
      const waitMs = Math.max(1, Math.ceil((needed / this.refillPerSec) * 1000));
      await this.sleep(waitMs);
    }
  }

  /** Returns current token count after refill. */
  private refill(key: string): number {
    const now = this.now();
    const prev = this.state.get(key);
    if (!prev) {
      this.state.set(key, { tokens: this.capacity, updatedAt: now });
      return this.capacity;
    }
    const elapsedSec = (now - prev.updatedAt) / 1000;
    const tokens = Math.min(this.capacity, prev.tokens + elapsedSec * this.refillPerSec);
    prev.tokens = tokens;
    prev.updatedAt = now;
    return tokens;
  }
}

export class NoopRateLimiter implements IRateLimiter {
  async acquire(_key: string): Promise<void> {
    return;
  }
}
