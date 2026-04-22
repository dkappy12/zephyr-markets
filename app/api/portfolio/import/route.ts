import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/require-user";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { createClient } from "@/lib/supabase/server";
import { normalisePositionInput } from "@/lib/portfolio/position-contract";
import { logAuthAuditEvent } from "@/lib/auth/audit";

type ImportItem = Record<string, unknown>;

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const supabase = await createClient();
  const auth = await requireUser(supabase, { requireVerifiedEmail: true });
  if (auth.response) return auth.response;
  const user = auth.user!;
  const entitlement = await requireEntitlement(supabase, user.id, {
    feature: "portfolioEnabled",
    minimumTier: "pro",
  });
  if (entitlement.response) return entitlement.response;
  const billingState = await getEffectiveBillingState(supabase, user.id);

  const rate = await checkRateLimit({
    key: user.id,
    bucket: "portfolio_import",
    limit: 8,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    await logAuthAuditEvent({
      event: "portfolio_import_rate_limited",
      userId: user.id,
      status: "failure",
      metadata: { retryAfterSec: rate.retryAfterSec },
    });
    return NextResponse.json(
      {
        code: "RATE_LIMITED",
        error: "Too many imports. Please wait and retry.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSec) },
      },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    rows?: ImportItem[];
    dryRun?: boolean;
  };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = body.dryRun !== false;

  if (rows.length === 0) {
    return NextResponse.json(
      { code: "INVALID_PAYLOAD", error: "rows[] is required." },
      { status: 400 },
    );
  }
  if (rows.length > 200) {
    return NextResponse.json(
      { code: "ROW_LIMIT", error: "Maximum 200 rows per import." },
      { status: 400 },
    );
  }

  const normalised: Array<{ index: number; row: ImportItem; dedupeKey: string }> = [];
  const prepared: Array<Record<string, unknown>> = [];
  const rejects: Array<{ index: number; error: string }> = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const normalized = normalisePositionInput(user.id, row);
    if (!normalized.ok) {
      rejects.push({ index, error: normalized.error });
      return;
    }
    if (seen.has(normalized.dedupeKey)) {
      rejects.push({ index, error: "Duplicate row in this import batch." });
      return;
    }
    seen.add(normalized.dedupeKey);
    normalised.push({ index, row, dedupeKey: normalized.dedupeKey });
    prepared.push(normalized.data);
  });

  if (rejects.length > 0) {
    await logAuthAuditEvent({
      event: "portfolio_import_validation_failed",
      userId: user.id,
      status: "failure",
      metadata: { accepted: prepared.length, rejected: rejects.length },
    });
    return NextResponse.json(
      {
        code: "VALIDATION_FAILED",
        error: "Some rows failed validation.",
        accepted: prepared.length,
        rejected: rejects.length,
        rejects,
      },
      { status: 400 },
    );
  }

  if (typeof billingState.entitlements.maxPositions === "number") {
    const { count, error: countError } = await supabase
      .from("positions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_closed", false);
    if (countError) {
      return NextResponse.json(
        { code: "POSITION_COUNT_FAILED", error: countError.message },
        { status: 500 },
      );
    }
    const openCount = count ?? 0;
    const maxPositions = billingState.entitlements.maxPositions;
    if (openCount + prepared.length > maxPositions) {
      return NextResponse.json(
        {
          code: "POSITION_LIMIT_REACHED",
          error: `Import would exceed position limit for ${billingState.effectiveTier} plan.`,
          maxPositions,
          openCount,
          attemptedImport: prepared.length,
        },
        { status: 409 },
      );
    }
  }

  if (dryRun) {
    await logAuthAuditEvent({
      event: "portfolio_import_dry_run_ok",
      userId: user.id,
      status: "info",
      metadata: { accepted: prepared.length },
    });
    return NextResponse.json({
      ok: true,
      dryRun: true,
      accepted: prepared.length,
      rejected: 0,
      rejects: [],
    });
  }

  const { error } = await supabase.from("positions").insert(prepared);
  if (error) {
    await logAuthAuditEvent({
      event: "portfolio_import_failed",
      userId: user.id,
      status: "failure",
      metadata: { details: error.message },
    });
    return NextResponse.json(
      {
        code: "IMPORT_FAILED",
        error: "Could not import positions.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  await logAuthAuditEvent({
    event: "portfolio_import_succeeded",
    userId: user.id,
    status: "success",
    metadata: { imported: prepared.length },
  });
  return NextResponse.json({
    ok: true,
    dryRun: false,
    imported: prepared.length,
    rejected: 0,
  });
}
