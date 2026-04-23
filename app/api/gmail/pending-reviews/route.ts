import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PendingReviewRow = {
  id: string;
  subject: string | null;
  sender: string | null;
  received_at: string | null;
  classified_positions: unknown;
};

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const { data, error } = await supabase
      .from("email_trade_imports")
      .select("id, subject, sender, received_at, classified_positions")
      .eq("user_id", user.id)
      .eq("status", "needs_review")
      .order("received_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const imports = (data ?? []) as PendingReviewRow[];
    return NextResponse.json({ count: imports.length, imports });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load pending reviews" },
      { status: 500 },
    );
  }
}
