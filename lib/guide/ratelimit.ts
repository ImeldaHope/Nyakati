/**
 * Copied from ihope.dev (lib/agent/ratelimit.ts), as the Nyakati plan asks.
 *
 * Rate limiting — per-IP token bucket + a hard global daily ceiling so a bad
 * actor can't run up load/cost. In-memory is fine for a small single-instance
 * site; swap for edge KV if it ever scales horizontally.
 */
const hits = new Map<string, { n: number; t: number }>();

/** Per-IP window limiter. Returns false when the caller should be throttled. */
export function allow(ip: string, max = 12, windowMs = 60_000): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.t > windowMs) {
    hits.set(ip, { n: 1, t: now });
    return true;
  }
  rec.n += 1;
  return rec.n <= max;
}

// Hard global ceiling — total model-bound requests per rolling day.
const DAILY_MAX = 2000;
let dayCount = 0;
let dayStart = Date.now();

/** Returns false once the global daily budget is exhausted. */
export function underDailyCeiling(): boolean {
  const now = Date.now();
  if (now - dayStart > 86_400_000) {
    dayStart = now;
    dayCount = 0;
  }
  dayCount += 1;
  return dayCount <= DAILY_MAX;
}
