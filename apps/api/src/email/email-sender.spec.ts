import { describe, expect, it } from 'vitest';
import { parseAddress } from './email-sender.js';

describe('parseAddress', () => {
  it('splits the EMAIL_FROM format into name and address', () => {
    expect(parseAddress('Hanker <no-reply@mail.hanker.dev>')).toEqual({
      name: 'Hanker',
      email: 'no-reply@mail.hanker.dev',
    });
  });

  it('rejects a bare address', () => {
    expect(() => parseAddress('no-reply@example.com')).toThrow(/Name <address@domain>/);
  });
});
