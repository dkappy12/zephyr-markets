import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if (auth.response) return auth.response;
  const user = auth.user!;

  const body = (await req.json().catch(() => ({}))) as { scope?: unknown };
  const scope = body.scope === "all" ? "all" : "open";

  const query = supabase.from("positions").delete().eq("user_id", user.id);
  const { error } =
    scope === "open" ? await query.eq("is_closed", false) : await query;
  if (error) {
    return NextResponse.json(
      { code: "CLEAR_FAILED", error: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, scope });
}
