/**
 * Heuristic: returns the last two labels of a domain.
 * `abc.com`             → `abc.com`
 * `sub.abc.com`         → `abc.com`
 * `deep.sub.abc.com`    → `abc.com`
 *
 * NOTE: not Public Suffix List aware. `foo.co.uk` → `co.uk` (wrong).
 * Adequate for milestone 5; upgrade with `psl` lib when multi-TLD needed.
 */
export function rootDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.');
  if (parts.length < 2) throw new Error(`domain.util: invalid domain "${domain}"`);
  return parts.slice(-2).join('.');
}

/** `wp_abc_com` from `abc.com`; safe for MySQL identifiers. */
export function dbNameFromDomain(domain: string): string {
  return `wp_${domain.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}
