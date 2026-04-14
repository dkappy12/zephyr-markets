import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { logAuthAuditEvent } from "@/lib/auth/audit";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if (auth.response) return auth.response;
  const user = auth.user!;

  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    close_price?: unknown;
    close_date?: unknown;
  };
  const id = typeof body.id === "string" ? body.id : "";
  const closePrice = asNumber(body.close_price);
  const closeDate = asDate(body.close_date);

  if (!id || closePrice == null || !closeDate) {
    return NextResponse.json(
      {
        code: "VALIDATION_FAILED",
        error: "id, close_price and close_date are required.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("positions")
    .update({ is_closed: true, close_price: closePrice, close_date: closeDate })
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("is_closed", false)
    .maybeSingle();
  if (error) {
    await logAuthAuditEvent({
      event: "portfolio_position_close_failed",
      userId: user.id,
      status: "failure",
      metadata: { id, details: error.message },
    });
    return NextResponse.json(
      { code: "CLOSE_FAILED", error: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      {
        code: "POSITION_NOT_OPEN",
        error: "Position not found, already closed, or you do not have access.",
      },
      { status: 404 },
    );
  }
  await logAuthAuditEvent({
    event: "portfolio_position_close_succeeded",
    userId: user.id,
    status: "success",
    metadata: { id },
  });
  return NextResponse.json({ ok: true });
}
