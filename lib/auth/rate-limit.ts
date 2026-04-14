type BucketState = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, BucketState>();

export function checkRateLimit(input: {
  key: string;
  bucket: string;
  limit: number;
  windowMs: number;
}) {
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
