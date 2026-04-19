import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/api-key";
import { createAdminClient } from "@/lib/supabase/admin";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;

/** In-memory sliding window per API key id (single-instance deployments). */
const requestTimestampsByKeyId = new Map<string, number[]>();

function pruneOlderThan(timestamps: number[], now: number): number[] {
  const cutoff = now - RATE_WINDOW_MS;
  return timestamps.filter((t) => t >= cutoff);
}

export type RequireApiKeyResult =
  | { response: NextResponse; userId?: undefined; keyId?: undefined }
  | { response: null; userId: string; keyId: string };

export async function requireApiKey(request: Request): Promise<RequireApiKeyResult> {
  const headerValue = request.headers.get("X-API-Key");
  if (headerValue === null || headerValue.trim() === "") {
    return {
      response: NextResponse.json(
        { error: "Missing X-API-Key header" },
        { status: 401 },
      ),
    };
  }

  const rawKey = headerValue.trim();
  if (!rawKey.startsWith("zk_live_")) {
    return {
      response: NextResponse.json(
        { error: "Invalid or revoked API key" },
        { status: 401 },
      ),
    };
  }

  const admin = createAdminClient();
  const result = await validateApiKey(admin, rawKey);

  if (!result.valid || result.userId === null || result.keyId === null) {
    return {
      response: NextResponse.json(
        { error: "Invalid or revoked API key" },
        { status: 401 },
      ),
    };
  }

  const now = Date.now();
  const keyId = result.keyId;
  let stamps = requestTimestampsByKeyId.get(keyId) ?? [];
  stamps = pruneOlderThan(stamps, now);

  if (stamps.length >= RATE_LIMIT) {
    requestTimestampsByKeyId.set(keyId, stamps);
    return {
      response: NextResponse.json(
        { error: "Rate limit exceeded", limit: 120, window: "60s" },
        { status: 429 },
      ),
    };
  }

  stamps.push(now);
  requestTimestampsByKeyId.set(keyId, stamps);

  return { response: null, userId: result.userId, keyId };
}
