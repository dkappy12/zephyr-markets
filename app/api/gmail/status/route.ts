import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const { data, error } = await supabase
      .from("gmail_connections")
      .select("gmail_address, broker_sender_filter")
      .eq("user_id", user.id)
      .maybeSingle<{
        gmail_address: string | null;
        broker_sender_filter: string | null;
      }>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      connected: Boolean(data),
      gmail_address: data?.gmail_address ?? null,
      broker_sender_filter: data?.broker_sender_filter ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Gmail status" },
      { status: 500 },
    );
  }
}
