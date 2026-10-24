import { describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth/sessions.service.js';
import { canLink } from './links.js';

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1',
  email: 'u1@example.com',
  displayName: 'U One',
  emailVerified: true,
  ...over,
});

describe('canLink (D76)', () => {
  it('is true for a verified user who does not own the list', () => {
    expect(canLink(user(), 'owner')).toBe(true);
  });

  it.each([
    ['a guest', null, 'owner'],
    ['an unverified user', user({ emailVerified: false }), 'owner'],
    ['the owner', user(), 'u1'],
    ['an unverified owner', user({ emailVerified: false }), 'u1'],
  ])('is false for %s', (_name, who, ownerId) => {
    expect(canLink(who, ownerId)).toBe(false);
  });
});
