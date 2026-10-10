import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmailTokensService } from '../src/auth/email-tokens.service.js';
import { hashToken } from '../src/security/tokens.js';
import { signUp } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp(db.url);
});

afterAll(async () => {
  await t.app.close();
  await db.close();
});

beforeEach(async () => {
  await db.truncateAll();
  t.reset();
});

describe('EmailTokensService.issue (spec §6.5: one live token per purpose)', () => {
  it('leaves exactly one live token when two are issued for the same user at once', async () => {
    await signUp(t);
    const [user] = (await db.pool.query<{ id: string }>('select id from users')).rows;
    if (!user) throw new Error('signup created no user');
    const tokens = t.app.get(EmailTokensService);

    let markIssued: () => void = () => undefined;
    let release: () => void = () => undefined;
    const issued = new Promise<void>((resolve) => {
      markIssued = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    // The first transaction issues a token, then stays open until released.
    const first = db.db.transaction(async (tx) => {
      const token = await tokens.issue(tx, user.id, 'reset_password');
      markIssued();
      await released;
      return token;
    });
    await issued;
    // The second starts while the first is open. Without a lock, its delete can't see the first's
    // uncommitted token, and both survive.
    const second = db.db.transaction((tx) => tokens.issue(tx, user.id, 'reset_password'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    const [, secondToken] = await Promise.all([first, second]);

    const { rows } = await db.pool.query<{ token_hash: string }>(
      "select token_hash from email_tokens where purpose = 'reset_password' and consumed_at is null",
    );
    expect(rows.map((r) => r.token_hash)).toEqual([hashToken(secondToken)]);
  });
});
