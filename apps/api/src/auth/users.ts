import { sql } from 'drizzle-orm';
import type { Database } from '../db/database.module.js';
import { users } from '../db/schema.js';

/**
 * The account for an address. The contracts have already lowercased it. Comparing on lower(email)
 * lets the unique index serve the lookup.
 */
export async function findUserByEmail(db: Database, email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`);
  return user;
}
