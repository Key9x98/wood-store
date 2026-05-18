export interface IssueCertInput {
  domain: string;
}

export interface IssueCertResult {
  domain: string;
  certPath: string;        // /etc/letsencrypt/live/<domain>/cert.pem
  fullchainPath: string;
  privkeyPath: string;
  chainPath: string;
  /** Approximate expiry, derived from default LE 90-day validity. Caller may re-read cert for exact value. */
  expiresAt: Date;
}

export type SslErrorCode =
  | 'ssl.dns_not_propagated'
  | 'ssl.certbot_failed'
  | 'ssl.dns_lookup_failed'
  | 'ssl.invalid_domain';

export class SslError extends Error {
  constructor(
    public code: SslErrorCode,
    public detail?: unknown,
  ) {
    super(code);
    this.name = 'SslError';
  }
}
