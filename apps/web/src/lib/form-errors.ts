import type { z } from 'zod';

/**
 * Plain-language messages for the contracts' rules, in place of Zod's (Plan 2b rule 23). Pass it to
 * zodResolver as `{ error: formErrorMap }`. A refinement's own message, such as the display
 * name's, wins.
 */
export const formErrorMap: z.core.$ZodErrorMap = (issue) => {
  const field = String(issue.path?.[0] ?? '');
  switch (issue.code) {
    case 'invalid_format':
      return field === 'email' ? 'Enter an email address, like ada@example.com.' : undefined;
    case 'too_small':
      if (issue.origin === 'number') return `Choose at least ${String(issue.minimum)}.`;
      if (Number(issue.minimum) > 1) return `Use at least ${String(issue.minimum)} characters.`;
      if (field === 'displayName') return 'Enter a name.';
      return /password/i.test(field) ? 'Enter your password.' : 'Fill this in.';
    case 'too_big':
      if (issue.origin === 'number') return `Choose ${String(issue.maximum)} or fewer.`;
      return `Use ${String(issue.maximum)} characters or fewer.`;
    default:
      return undefined;
  }
};
