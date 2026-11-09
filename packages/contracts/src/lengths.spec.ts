import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DisplayNameSchema, PasswordSchema } from './auth.js';
import { maxUnits, minUnits } from './lengths.js';
import { TagNameSchema } from './tags.js';
import { visibleOnly } from './text.js';
import { ItemTitleSchema, NoteSchema, PriceTextSchema, WishlistTitleSchema } from './wishlist.js';

// U+10000 and U+1F600: two UTF-16 units each, one code point.
const ASTRAL = ['𐀀', '😀'];

describe('minUnits and maxUnits (D41)', () => {
  it('count UTF-16 units, so an emoji costs two', () => {
    const schema = z.string().check(minUnits(2), maxUnits(3));
    expect(schema.safeParse('😀').success).toBe(true);
    expect(schema.safeParse('😀a').success).toBe(true);
    expect(schema.safeParse('😀😀').error?.issues).toMatchObject([
      { code: 'too_big', origin: 'string', maximum: 3, inclusive: true },
    ]);
    expect(schema.safeParse('a').error?.issues).toMatchObject([
      { code: 'too_small', origin: 'string', minimum: 2, inclusive: true },
    ]);
  });

  it('raise the same issues as zod’s .min and .max wherever units and code points agree', () => {
    const bmp = fc.string({
      unit: fc.integer({ min: 0, max: 0xd7ff }).map((code) => String.fromCharCode(code)),
      maxLength: 12,
    });
    fc.assert(
      fc.property(bmp, fc.nat({ max: 6 }), fc.nat({ max: 6 }), (value, min, extra) => {
        const max = min + extra;
        const zods = z.string().trim().min(min).max(max).refine(visibleOnly, 'visible');
        const ours = z
          .string()
          .trim()
          .check(minUnits(min), maxUnits(max))
          .refine(visibleOnly, 'visible');
        const shape = (result: z.ZodSafeParseResult<string>) =>
          result.error?.issues.map(({ code, message, path }) => ({ code, message, path }));
        expect(shape(ours.safeParse(value))).toEqual(shape(zods.safeParse(value)));
      }),
    );
  });
});

describe('field lengths count UTF-16 units (D41)', () => {
  const fields: [string, z.ZodType, number][] = [
    ['WishlistTitleSchema', WishlistTitleSchema, 100],
    ['ItemTitleSchema', ItemTitleSchema, 200],
    ['PriceTextSchema', PriceTextSchema, 50],
    ['NoteSchema', NoteSchema, 1000],
    ['DisplayNameSchema', DisplayNameSchema, 50],
    ['TagNameSchema', TagNameSchema, 30],
    ['PasswordSchema', PasswordSchema, 128],
  ];

  it.each(fields)(
    '%s takes exactly its limit in emoji, and refuses one unit more',
    (_, schema, max) => {
      const atLimit = '😀'.repeat(max / 2);
      expect(atLimit).toHaveLength(max);
      expect(schema.safeParse(atLimit).success).toBe(true);
      expect(schema.safeParse(`${atLimit}a`).error?.issues).toMatchObject([
        { code: 'too_big', maximum: max },
      ]);
    },
  );

  it.each(fields)('%s never keeps more UTF-16 units than its limit', (_, schema, max) => {
    // n pieces of one or two units each: from half the limit to twice it, so both sides are tried.
    const text = fc
      .integer({ min: Math.floor(max / 2) - 2, max })
      .chain((n) => fc.array(fc.constantFrom(...ASTRAL, 'a', ' '), { minLength: n, maxLength: n }))
      .map((pieces) => pieces.join(''));
    fc.assert(
      fc.property(text, (value) => {
        const parsed = schema.safeParse(value);
        if (parsed.success && typeof parsed.data === 'string') {
          expect(parsed.data.length).toBeLessThanOrEqual(max);
        }
      }),
    );
  });

  it('counts a password’s minimum in units too', () => {
    expect(PasswordSchema.safeParse('😀'.repeat(5)).success).toBe(true);
  });
});
