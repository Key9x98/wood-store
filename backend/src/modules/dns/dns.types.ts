export type DnsRecordType = 'A' | 'CNAME' | 'TXT' | 'MX';

export interface DnsRecord {
  id: string;
  zone: string;          // zone NAME (e.g. "example.com")
  name: string;          // FQDN (e.g. "abc.example.com")
  type: DnsRecordType;
  content: string;
  ttl: number;
  proxied?: boolean;
}

export interface UpsertARequest {
  zone: string;
  name: string;
  content: string;       // IPv4
  ttl?: number;          // default 300
  proxied?: boolean;     // Cloudflare-only
}

export interface FindRecordRequest {
  zone: string;
  name: string;
  type?: DnsRecordType;
}

export interface DeleteRecordRequest {
  zone: string;
  recordId: string;
}

export type DnsErrorCode =
  | 'dns.zone_not_found'
  | 'dns.unauthorized'
  | 'dns.rate_limited'
  | 'dns.provider_error'
  | 'dns.invalid_response'
  | 'dns.network_error';

export class DnsError extends Error {
  constructor(
    public code: DnsErrorCode,
    public detail?: unknown,
  ) {
    super(code);
    this.name = 'DnsError';
  }
}
