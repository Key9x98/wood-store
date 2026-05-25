export const STEP_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'N', 'G', 'L', 'M', 'H', 'I', 'J', 'K'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export interface StepRecord<T> {
  done: boolean;
  at: string;
  artefact?: T;
}

export interface StepArtefacts {
  A: undefined;
  B: { recordId: string; zone: string };
  C: { siteRoot: string };
  D: { dbName: string; dbUser: string };
  E: { imported: boolean };
  F: { configPath: string };
  N: undefined;
  G: undefined;
  L: undefined;
  M: undefined;
  H: { configPath: string; enabledPath: string };
  I: { certPath: string; fullchainPath: string; expiresAt: string };
  J: undefined;
  K: undefined;
}

export type ProvisionState = {
  steps: {
    [K in StepKey]?: StepRecord<StepArtefacts[K]>;
  };
};

/**
 * Web server abstraction for provision step H. Implemented by both
 * NginxService and ApacheService so the orchestrator stays server-agnostic.
 */
export interface WebServerService {
  deployConfig(
    domain: string,
    siteRoot: string,
  ): Promise<{ configPath: string; enabledPath: string }>;
  remove(domain: string): Promise<void>;
}

export type ProvisionErrorCode =
  | 'provision.site_not_found'
  | 'provision.template_not_found'
  | 'provision.invalid_domain'
  | 'provision.not_claimable'
  | 'provision.step_failed';

export class ProvisionError extends Error {
  constructor(
    public code: ProvisionErrorCode,
    public detail?: unknown,
  ) {
    super(code);
    this.name = 'ProvisionError';
  }
}
