import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const csrf = assertSameOrigin(request);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const body = (await request.json().catch(() => ({}))) as {
      broker_sender_filter?: unknown;
    };
    const brokerSenderFilter =
      typeof body.broker_sender_filter === "string"
        ? body.broker_sender_filter.trim()
        : "";

    if (!brokerSenderFilter) {
      return NextResponse.json(
        { error: "broker_sender_filter must be a non-empty string" },
        { status: 400 },
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("gmail_connections")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle<{ user_id: string }>();
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json(
        { error: "No Gmail account connected" },
        { status: 400 },
      );
    }

    const { error: updateError } = await supabase
      .from("gmail_connections")
      .update({ broker_sender_filter: brokerSenderFilter })
      .eq("user_id", user.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update filter" },
      { status: 500 },
    );
  }
}
