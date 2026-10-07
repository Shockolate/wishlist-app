/**
 * Base class for expected, client-facing failures. The problem-details filter renders these as
 * RFC 9457 responses; `extras` become extension members (e.g. `remaining` on a claim conflict).
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
    readonly extras: Readonly<Record<string, unknown>> = {},
  ) {
    super(detail ?? code);
    this.name = new.target.name;
  }
}
