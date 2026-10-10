import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { sessions, users } from '../db/schema.js';
import { hashToken, newToken } from '../security/tokens.js';
import { SESSION_REFRESH_MS, SESSION_TTL_MS } from './session-cookie.js';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

export interface ActiveSession {
  sessionId: string;
  user: SessionUser;
}

/** Database sessions (spec §6.1, D16): revocable at once, at the cost of one indexed lookup. */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(userId: string): Promise<{ token: string }> {
    const now = this.clock.now();
    const token = newToken(32);
    await this.db.insert(sessions).values({
      id: hashToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
    return { token };
  }

  /**
   * The live session for a token. Its database expiry slides forward at most once an hour; the
   * cookie is never touched, because the database alone decides (D27).
   */
  async resolve(token: string): Promise<ActiveSession | null> {
    const now = this.clock.now();
    const sessionId = hashToken(token);
    const [row] = await this.db
      .select({
        lastSeenAt: sessions.lastSeenAt,
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)));
    if (!row) return null;

    if (now.getTime() - row.lastSeenAt.getTime() >= SESSION_REFRESH_MS) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
        .where(eq(sessions.id, sessionId));
    }
    return {
      sessionId,
      user: {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        emailVerified: row.emailVerifiedAt !== null,
      },
    };
  }

  async revoke(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
}
