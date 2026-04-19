import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const RAW_KEY_PREFIX = "zk_live_";

export function generateApiKey(): {
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  const bytes = randomBytes(32);
  const encoded = bytes.toString("base64url");
  const rawKey = `${RAW_KEY_PREFIX}${encoded}`;
  const keyHash = createHash("sha256").update(rawKey, "utf8").digest("hex");
  const keyPrefix = rawKey.slice(0, 12);
  return { rawKey, keyHash, keyPrefix };
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export async function validateApiKey(
  supabaseAdmin: SupabaseClient,
  rawKey: string,
): Promise<{ valid: boolean; userId: string | null; keyId: string | null }> {
  const keyHash = hashApiKey(rawKey);

  const { data: row, error: selectError } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id, request_count")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (selectError || !row) {
    return { valid: false, userId: null, keyId: null };
  }

  const { error: updateError } = await supabaseAdmin
    .from("api_keys")
    .update({
      last_used_at: new Date().toISOString(),
      request_count: (row.request_count ?? 0) + 1,
    })
    .eq("id", row.id);

  if (updateError) {
    return { valid: false, userId: null, keyId: null };
  }

  return {
    valid: true,
    userId: row.user_id ?? null,
    keyId: row.id,
  };
}
