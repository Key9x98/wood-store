import { env } from '../../config/env';
import type { DnsProvider } from './dns.provider';
import { CloudflareProvider } from './cloudflare.provider';
import { MockDnsProvider } from './mock.provider';
import { TokenBucketRateLimiter } from './dns.rate-limiter';

function buildProvider(): DnsProvider {
  if (env.DNS_PROVIDER === 'mock') {
    return new MockDnsProvider();
  }
  // 4 req/s per zone — Cloudflare's documented sustained limit
  const limiter = new TokenBucketRateLimiter(4, 4);
  return new CloudflareProvider({
    apiToken: env.CLOUDFLARE_API_TOKEN,
    rateLimiter: limiter,
  });
}

export const dnsProvider: DnsProvider = buildProvider();
