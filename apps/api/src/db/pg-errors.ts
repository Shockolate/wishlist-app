/** Postgres's SQLSTATEs for unique_violation and foreign_key_violation. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Whether `error` carries this SQLSTATE on `constraint`. Drizzle wraps the driver's error, keeping
 * it as `cause`, so this looks a few levels down.
 */
function isViolation(error: unknown, sqlState: string, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth++) {
    const { code, constraint: name, cause } = current as Record<string, unknown>;
    if (code === sqlState && name === constraint) return true;
    current = cause;
  }
  return false;
}

/** Whether `error` is a unique_violation on `constraint`. */
export const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  isViolation(error, UNIQUE_VIOLATION, constraint);

/** Whether `error` is a foreign_key_violation on `constraint`: the row it points at is gone. */
export const isForeignKeyViolation = (error: unknown, constraint: string): boolean =>
  isViolation(error, FOREIGN_KEY_VIOLATION, constraint);
