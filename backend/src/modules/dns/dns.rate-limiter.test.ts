import { describe, it, expect, vi } from 'vitest';
import { TokenBucketRateLimiter } from './dns.rate-limiter';

describe('TokenBucketRateLimiter', () => {
  it('initially allows burst up to capacity without waiting', async () => {
    const nowVal = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const limiter = new TokenBucketRateLimiter(
      4,
      4, // 4 tokens, 4/sec refill
      () => nowVal,
      sleep,
    );

    for (let i = 0; i < 4; i++) {
      await limiter.acquire('zone1');
    }
    expect(sleep).not.toHaveBeenCalled();
  });

  it('sleeps when bucket is empty', async () => {
    let nowVal = 0;
    const sleeps: number[] = [];
    const sleep = vi.fn().mockImplementation((ms: number) => {
      sleeps.push(ms);
      nowVal += ms; // advance virtual time
      return Promise.resolve();
    });
    const limiter = new TokenBucketRateLimiter(
      4,
      4,
      () => nowVal,
      sleep,
    );

    for (let i = 0; i < 5; i++) {
      await limiter.acquire('zone1');
    }
    expect(sleep).toHaveBeenCalled();
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  it('isolates buckets per key', async () => {
    const nowVal = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const limiter = new TokenBucketRateLimiter(
      2,
      2,
      () => nowVal,
      sleep,
    );

    await limiter.acquire('zoneA');
    await limiter.acquire('zoneA');
    // zoneA exhausted, zoneB should still have full capacity
    await limiter.acquire('zoneB');
    await limiter.acquire('zoneB');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('refills over time', async () => {
    let nowVal = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const limiter = new TokenBucketRateLimiter(
      4,
      4,
      () => nowVal,
      sleep,
    );

    for (let i = 0; i < 4; i++) {
      await limiter.acquire('zone1');
    }
    // 1 second later → bucket fully refilled
    nowVal += 1000;
    for (let i = 0; i < 4; i++) {
      await limiter.acquire('zone1');
    }
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws on invalid config', () => {
    expect(() => new TokenBucketRateLimiter(0, 1)).toThrow();
    expect(() => new TokenBucketRateLimiter(1, 0)).toThrow();
  });
});
