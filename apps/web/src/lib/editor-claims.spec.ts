import { describe, expect, it } from 'vitest';
import { editorClaimLine } from './editor-claims';

const claim = (n: number, claimerName: string, quantity = 1) => ({
  id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  claimerName,
  quantity,
});

describe('editorClaimLine (the Plan 4b mockups)', () => {
  it('says nothing unless the owner has opted in (spec §5.1)', () => {
    expect(editorClaimLine({ quantity: 1 })).toBeNull();
  });

  it('says when nobody has claimed it yet', () => {
    expect(editorClaimLine({ quantity: 1, claims: [] })).toEqual({
      text: 'No claims yet',
      kind: 'none',
    });
  });

  it('names who is getting an item nobody else can claim', () => {
    expect(editorClaimLine({ quantity: 1, claims: [claim(1, 'Aunt Sue')] })).toEqual({
      text: 'Aunt Sue is getting this',
      kind: 'taken',
    });
    expect(
      editorClaimLine({ quantity: 2, claims: [claim(1, 'Aunt Sue'), claim(2, 'Sam')] }),
    ).toEqual({ text: 'Aunt Sue and Sam are getting this', kind: 'taken' });
    // Fewer wanted than claimed (D19) still reads as taken.
    expect(editorClaimLine({ quantity: 1, claims: [claim(1, 'Sam', 3)] })?.kind).toBe('taken');
  });

  it('lists who is getting how many, and what is left', () => {
    expect(editorClaimLine({ quantity: 3, claims: [claim(1, 'Sam'), claim(2, 'Priya')] })).toEqual({
      text: 'Sam ×1, Priya ×1 · 1 left',
      kind: 'some',
    });
  });
});
