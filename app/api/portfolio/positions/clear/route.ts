import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { logAuthAuditEvent } from "@/lib/auth/audit";

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const supabase = await createClient();
  const auth = await requireUser(supabase, { requireVerifiedEmail: true });
  if (auth.response) return auth.response;
  const user = auth.user!;

  const body = (await req.json().catch(() => ({}))) as { scope?: unknown };
  const scope = body.scope === "all" ? "all" : "open";

  const query = supabase.from("positions").delete().eq("user_id", user.id).select("id");
  const { data, error } =
    scope === "open" ? await query.eq("is_closed", false) : await query;
  if (error) {
    await logAuthAuditEvent({
      event: "portfolio_positions_clear_failed",
      userId: user.id,
      status: "failure",
      metadata: { scope, details: error.message },
    });
    return NextResponse.json(
      { code: "CLEAR_FAILED", error: error.message },
      { status: 500 },
    );
  }
  await logAuthAuditEvent({
    event: "portfolio_positions_clear_succeeded",
    userId: user.id,
    status: "success",
    metadata: { scope, deleted: Array.isArray(data) ? data.length : 0 },
  });
  return NextResponse.json({
    ok: true,
    scope,
    deleted: Array.isArray(data) ? data.length : 0,
  });
}
