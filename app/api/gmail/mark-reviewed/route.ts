import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const csrf = assertSameOrigin(request);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const body = (await request.json().catch(() => ({}))) as {
      import_id?: unknown;
    };
    const importId = typeof body.import_id === "string" ? body.import_id.trim() : "";
    if (!importId) {
      return NextResponse.json({ error: "import_id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("email_trade_imports")
      .update({ status: "reviewed" })
      .eq("id", importId)
      .eq("user_id", user.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to mark review" },
      { status: 500 },
    );
  }
}
