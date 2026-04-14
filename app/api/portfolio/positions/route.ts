import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { normalisePositionInput } from "@/lib/portfolio/position-contract";

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

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

  const { error } = await supabase.from("positions").insert(normalized.data);
  if (error) {
    return NextResponse.json(
      { code: "CREATE_FAILED", error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
