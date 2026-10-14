/**
 * Control and format characters: newlines, tabs, bidirectional overrides, zero-width spaces. They
 * can make a name lie about what it says. The two joiners are allowed inside a name: emoji
 * sequences need the zero-width joiner (U+200D), and Persian needs the non-joiner (U+200C).
 */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
const JOINERS = /[\u200C\u200D]/gu;

/**
 * Letters and marks that draw nothing (D41): the Hangul fillers, the Braille blank, the combining
 * grapheme joiner and two Khmer inherent vowels. They aren't control or format characters, so
 * HIDDEN_CHARACTERS lets them through; a name made only of them would still show as blank. The
 * marks come first so that no-misleading-character-class doesn't read one as joined to its neighbor.
 */
const BLANK_LETTERS = /[\u034F\u17B4\u17B5\u115F\u1160\u3164\uFFA0\u2800]/gu;

/** The message for a value that fails `visibleOnly`. */
export const VISIBLE_ONLY_MESSAGE = 'Use visible characters only';

/**
 * Whether a trimmed name or title is made of visible characters (D35, D41). An empty value passes:
 * that is `min(1)`'s job, so each input gets exactly one issue.
 */
export function visibleOnly(name: string): boolean {
  if (name.length === 0) return true;
  const rest = name.replace(JOINERS, '');
  // Joiners, spaces and blank letters alone would show as a blank name (D41).
  return rest.replace(BLANK_LETTERS, '').trim().length > 0 && !HIDDEN_CHARACTERS.test(rest);
}
