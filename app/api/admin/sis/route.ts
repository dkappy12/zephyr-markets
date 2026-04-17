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

  const { data: runs } = await admin
    .schema("governance")
    .from("coefficient_updates")
    .select(
      "run_id, run_started_at, run_finished_at, n_observations, decision, reason, gate_results, prior_coefficients, posterior_coefficients, runtime_ms",
    )
    .order("run_started_at", { ascending: false })
    .limit(20);

  const { data: currentVersion } = await admin
    .schema("governance")
    .from("model_versions")
    .select(
      "version, effective_from, change_summary, b1, b2, b3, b4, b5, w1, w2, w3, metric_mae, metric_bias, metric_sample_n",
    )
    .eq("is_current", true)
    .maybeSingle();

  const { count: totalVersions } = await admin
    .schema("governance")
    .from("model_versions")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({
    runs: runs ?? [],
    currentVersion: currentVersion ?? null,
    totalVersions: totalVersions ?? 0,
  });
}
