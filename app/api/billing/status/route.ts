import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;

    const state = await getEffectiveBillingState(supabase, auth.user!.id);
    return NextResponse.json({
      ...state,
      accessState: state.accessState,
      actionRequired: state.actionRequired,
      statusLabel: state.statusLabel,
      canUsePremiumNow: state.canUsePremiumNow,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load billing status" },
      { status: 500 },
    );
  }
}
