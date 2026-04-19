import { NextResponse } from "next/server";
import { generateApiKey } from "@/lib/api/api-key";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { requireUser } from "@/lib/auth/require-user";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const API_KEY_ENTITLEMENT = {
  feature: "apiAccess" as const,
  minimumTier: "team" as const,
};

export async function POST(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const entitlement = await requireEntitlement(supabase, user.id, API_KEY_ENTITLEMENT);
    if (entitlement.response) return entitlement.response;

    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : "Default";

    const { rawKey, keyHash, keyPrefix } = generateApiKey();
    const admin = createAdminClient();

    const { data: row, error } = await admin
      .from("api_keys")
      .insert({
        user_id: user.id,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        name,
      })
      .select("created_at")
      .single();

    if (error || !row) {
      throw new Error(error?.message ?? "Failed to create API key");
    }

    return NextResponse.json({
      keyPrefix,
      rawKey,
      createdAt: row.created_at as string,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create API key" },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const entitlement = await requireEntitlement(supabase, user.id, API_KEY_ENTITLEMENT);
    if (entitlement.response) return entitlement.response;

    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("api_keys")
      .select("id, key_prefix, name, created_at, last_used_at, request_count")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const list = (rows ?? []).map((r) => ({
      id: r.id as string,
      keyPrefix: r.key_prefix as string,
      name: r.name as string,
      createdAt: r.created_at as string,
      lastUsedAt: (r.last_used_at as string | null) ?? null,
      requestCount: (r.request_count as number | null) ?? 0,
    }));

    return NextResponse.json(list);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list API keys" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const entitlement = await requireEntitlement(supabase, user.id, API_KEY_ENTITLEMENT);
    if (entitlement.response) return entitlement.response;

    const body = (await req.json().catch(() => ({}))) as { id?: string };
    const keyId = typeof body.id === "string" ? body.id.trim() : "";
    if (!keyId) {
      return NextResponse.json({ error: "Key id is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: updated, error } = await admin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id");

    if (error) {
      throw new Error(error.message);
    }

    if (!updated?.length) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to revoke API key" },
      { status: 500 },
    );
  }
}
