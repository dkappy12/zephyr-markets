import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { normalisePositionInput } from "@/lib/portfolio/position-contract";

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
  const auth = await requireUser(supabase);
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

  const { error } = await supabase
    .from("positions")
    .update(normalized.data)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { code: "UPDATE_FAILED", error: error.message },
      { status: 500 },
    );
  }
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
  const auth = await requireUser(supabase);
  if (auth.response) return auth.response;
  const user = auth.user!;

  const { error } = await supabase
    .from("positions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { code: "DELETE_FAILED", error: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
