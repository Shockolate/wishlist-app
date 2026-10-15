/** Postgres's SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether `error` is a unique_violation on `constraint`. Drizzle wraps the driver's error, keeping
 * it as `cause`, so this looks a few levels down.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth++) {
    const { code, constraint: name, cause } = current as Record<string, unknown>;
    if (code === UNIQUE_VIOLATION && name === constraint) return true;
    current = cause;
  }
  return false;
}
