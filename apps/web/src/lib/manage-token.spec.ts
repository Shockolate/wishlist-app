import { CAPABILITY_TOKEN_PATTERN } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { mintManageToken } from './manage-token';

describe('mintManageToken (D42)', () => {
  it('is 16 random bytes in base64url: 22 characters the API accepts', () => {
    expect(mintManageToken()).toMatch(CAPABILITY_TOKEN_PATTERN);
    expect(mintManageToken()).not.toBe(mintManageToken());
  });

  it('encodes the bytes without padding, using - and _', () => {
    expect(mintManageToken((bytes) => bytes.fill(0))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(mintManageToken((bytes) => bytes.fill(255))).toBe('_____________________w');
    expect(mintManageToken((bytes) => bytes.fill(0xfb))).toMatch(/^[-\w]{22}$/);
  });
});
