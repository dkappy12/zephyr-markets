import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { requireAdminUser } from "@/lib/auth/require-admin-user";
import { logEvent } from "@/lib/ops/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SubscriptionEventRow = {
  stripe_event_id: string | null;
  event_type: string | null;
  processed_at: string | null;
  user_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string | null;
  tier: string | null;
  interval: string | null;
};

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function GET() {
  let adminUserId: string | null = null;
  try {
    const supabase = await createClient();
    const auth = await requireAdminUser(supabase);
    if (auth.response) return auth.response;
    adminUserId = auth.user!.id;

    const rateLimit = await checkRateLimit({
      key: adminUserId,
      bucket: "admin_billing_health",
      limit: 30,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      logEvent({
        scope: "admin_billing",
        event: "health_rate_limited",
        level: "warn",
        data: { adminUserId },
      });
      return NextResponse.json(
        {
          code: "RATE_LIMITED",
          error: "Too many requests. Please wait before retrying.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSec) },
        },
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("subscription_events")
      .select(
        "stripe_event_id,event_type,processed_at,user_id,stripe_customer_id,stripe_subscription_id,status,tier,interval",
      )
      .order("processed_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as SubscriptionEventRow[];
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    let last1h = 0;
    let last24h = 0;
    const ids = new Set<string>();
    let withId = 0;

    for (const r of rows) {
      const t = parseDate(r.processed_at)?.getTime();
      if (t != null) {
        if (t >= oneHourAgo) last1h += 1;
        if (t >= oneDayAgo) last24h += 1;
      }
      if (r.stripe_event_id) {
        withId += 1;
        ids.add(r.stripe_event_id);
      }
    }

    const duplicates = Math.max(0, withId - ids.size);
    const duplicateRate = withId ? duplicates / withId : 0;

    const manualReconciles = rows
      .filter((r) => r.event_type === "manual.reconcile")
      .slice(0, 10)
      .map((r) => ({
        stripe_event_id: r.stripe_event_id,
        processed_at: r.processed_at,
        user_id: r.user_id,
        stripe_customer_id: r.stripe_customer_id,
        stripe_subscription_id: r.stripe_subscription_id,
        status: r.status,
        tier: r.tier,
        interval: r.interval,
      }));

    logEvent({
      scope: "admin_billing",
      event: "health_summary_loaded",
      data: {
        adminUserId,
        sampleSize: rows.length,
        last1h,
        last24h,
        duplicates,
      },
    });

    return NextResponse.json({
      ok: true,
      sampleSize: rows.length,
      totals: {
        last1h,
        last24h,
      },
      duplicates: {
        countedOver: withId,
        distinctEventIds: ids.size,
        duplicates,
        duplicateRate,
      },
      manualReconciles,
    });
  } catch (e: unknown) {
    logEvent({
      scope: "admin_billing",
      event: "health_summary_failed",
      level: "error",
      data: {
        adminUserId,
        error: e instanceof Error ? e.message : "Failed to load billing health",
      },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load billing health" },
      { status: 500 },
    );
  }
}

