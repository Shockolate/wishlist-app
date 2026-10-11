/**
 * Where to go after logging in. Only a same-site path survives (Plan 2b rule 9, Review Focus 4).
 * Whitespace and control characters are refused because browsers strip them, which turns
 * "/\t/evil" into "//evil".
 */
export function safeNext(value: string | null | undefined, fallback = '/list'): string {
  if (!value || !value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what we refuse
  if (/[\u0000-\u001F\u007F\s]/.test(value)) return fallback;
  return value;
}
