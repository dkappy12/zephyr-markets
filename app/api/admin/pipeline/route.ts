import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/require-admin-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const auth = await requireAdminUser(supabase);
  if (auth.response) return auth.response;

  const admin = createAdminClient();

  const { data: feeds } = await admin
    .schema("ops")
    .from("pipeline_health_live")
    .select(
      "feed_id, feed_name, category, last_success_ts, last_error, staleness_status, staleness_seconds, consecutive_failures, expected_cadence_seconds, updated_at",
    )
    .order("feed_name", { ascending: true });

  return NextResponse.json({ feeds: feeds ?? [] });
}
