type BucketState = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, BucketState>();

export async function checkRateLimit(input: {
  key: string;
  bucket: string;
  limit: number;
  windowMs: number;
}) {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (upstashUrl && upstashToken) {
    const redisKey = `ratelimit:${input.bucket}:${input.key}`;
    try {
      const resp = await fetch(`${upstashUrl}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${upstashToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          ["INCR", redisKey],
          ["PTTL", redisKey],
          ["PEXPIRE", redisKey, String(input.windowMs), "NX"],
        ]),
      });
      const data = (await resp.json().catch(() => null)) as
        | Array<{ result?: number | string | null }>
        | null;
      const count = Number(data?.[0]?.result ?? 0);
      let pttl = Number(data?.[1]?.result ?? -1);
      if (!Number.isFinite(pttl) || pttl < 0) pttl = input.windowMs;
      if (count > input.limit) {
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil(pttl / 1000)),
        };
      }
      return { allowed: true, retryAfterSec: 0 };
    } catch {
      // Fall back to in-memory limiter if Redis is unavailable.
    }
  }

  const now = Date.now();
  const id = `${input.bucket}:${input.key}`;
  const current = buckets.get(id);

  if (!current || now >= current.resetAt) {
    buckets.set(id, { count: 1, resetAt: now + input.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (current.count >= input.limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  buckets.set(id, current);
  return { allowed: true, retryAfterSec: 0 };
}
