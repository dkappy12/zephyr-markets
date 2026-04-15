import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { normalisePositionInput } from "@/lib/portfolio/position-contract";
import { logAuthAuditEvent } from "@/lib/auth/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { code: "INVALID_ID", error: "Position id is required." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const auth = await requireUser(supabase, { requireVerifiedEmail: true });
  if (auth.response) return auth.response;
  const user = auth.user!;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const normalized = normalisePositionInput(user.id, body);
  if (!normalized.ok) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", error: normalized.error },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("positions")
    .update(normalized.data)
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    await logAuthAuditEvent({
      event: "portfolio_position_update_failed",
      userId: user.id,
      status: "failure",
      metadata: { id, details: error.message },
    });
    return NextResponse.json(
      { code: "UPDATE_FAILED", error: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      {
        code: "POSITION_NOT_FOUND",
        error: "Position not found or you do not have access.",
      },
      { status: 404 },
    );
  }
  await logAuthAuditEvent({
    event: "portfolio_position_update_succeeded",
    userId: user.id,
    status: "success",
    metadata: { id },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { code: "INVALID_ID", error: "Position id is required." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const auth = await requireUser(supabase, { requireVerifiedEmail: true });
  if (auth.response) return auth.response;
  const user = auth.user!;

  const { data, error } = await supabase
    .from("positions")
    .delete()
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    await logAuthAuditEvent({
      event: "portfolio_position_delete_failed",
      userId: user.id,
      status: "failure",
      metadata: { id, details: error.message },
    });
    return NextResponse.json(
      { code: "DELETE_FAILED", error: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      {
        code: "POSITION_NOT_FOUND",
        error: "Position not found or you do not have access.",
      },
      { status: 404 },
    );
  }
  await logAuthAuditEvent({
    event: "portfolio_position_delete_succeeded",
    userId: user.id,
    status: "success",
    metadata: { id },
  });
  return NextResponse.json({ ok: true });
}
