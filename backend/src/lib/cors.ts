import type { CorsOptions } from 'cors';

/**
 * Build CORS options from a comma-separated origin list. `*` (or list containing `*`)
 * yields a permissive policy (origin reflection). Otherwise an explicit allow-list
 * with credentials enabled.
 */
export function buildCorsOptions(originsCsv: string): CorsOptions {
  const origins = originsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origins.includes('*')) {
    return { origin: true };
  }
  return { origin: origins, credentials: true };
}
