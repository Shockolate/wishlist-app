import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { validationFailed } from './errors.js';

/**
 * Validates and normalizes a request body against its contracts schema (spec §5), as in
 * `@Body(new ZodValidationPipe(SignupRequestSchema))`. It's applied per parameter, because only
 * the handler knows which schema applies. Messages name the field and the rule, never the value.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw validationFailed(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(body)',
        message: issue.message,
      })),
    );
  }
}
