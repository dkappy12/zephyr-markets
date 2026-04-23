import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export async function POST(request: Request) {
  try {
    const csrf = assertSameOrigin(request);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const { data: connection, error: readError } = await supabase
      .from("gmail_connections")
      .select("access_token")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) {
      return NextResponse.json({ error: readError.message }, { status: 500 });
    }

    if (connection?.access_token) {
      const revokeUrl = `${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(connection.access_token)}`;
      await fetch(revokeUrl, { method: "POST", cache: "no-store" });
    }

    const { error: deleteError } = await supabase
      .from("gmail_connections")
      .delete()
      .eq("user_id", user.id);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to disconnect Gmail" },
      { status: 500 },
    );
  }
}
