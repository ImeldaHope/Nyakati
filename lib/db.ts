import { Pool } from "pg";

// One pool per server process; reused across hot reloads in development.
const globalForPool = globalThis as unknown as { nyakatiPool?: Pool };

export const pool = globalForPool.nyakatiPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

if (process.env.NODE_ENV !== "production") globalForPool.nyakatiPool = pool;

// The review screen writes to the database, so it only exists where it is switched on (local dev).
export function reviewEnabled(): boolean {
  return process.env.REVIEW_ENABLED === "1" && Boolean(process.env.DATABASE_URL);
}
