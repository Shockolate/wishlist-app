/**
 * Control and format characters: newlines, tabs, bidirectional overrides, zero-width spaces. They
 * can make a name lie about what it says. The two joiners are allowed inside a name: emoji
 * sequences need the zero-width joiner (U+200D), and Persian needs the non-joiner (U+200C).
 */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
const JOINERS = /[\u200C\u200D]/gu;

/** The message for a value that fails `visibleOnly`. */
export const VISIBLE_ONLY_MESSAGE = 'Use visible characters only';

/**
 * Whether a trimmed name or title is made of visible characters (D35). An empty value passes: that
 * is `min(1)`'s job, so each input gets exactly one issue.
 */
export function visibleOnly(name: string): boolean {
  if (name.length === 0) return true;
  const rest = name.replace(JOINERS, '');
  // Joiners and spaces alone would show as a blank name.
  return rest.trim().length > 0 && !HIDDEN_CHARACTERS.test(rest);
}
