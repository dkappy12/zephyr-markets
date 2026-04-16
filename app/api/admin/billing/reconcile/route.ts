import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/require-admin-user";
import { mapStripeSubscriptionToBillingFields } from "@/lib/billing/stripe-subscription-mapper";
import { getStripe } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function pickBestSubscription(subscriptions: Array<{ status: string; created: number }>) {
  const preferred = new Set(["active", "trialing", "past_due"]);
  const filtered = subscriptions.filter((s) => preferred.has(s.status));
  const pool = filtered.length ? filtered : subscriptions;
  return pool.sort((a, b) => b.created - a.created)[0] ?? null;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const auth = await requireAdminUser(supabase);
    if (auth.response) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { userId?: string };
    const userId = String(body.userId ?? "").trim();
    if (!userId) {
      return NextResponse.json(
        { code: "BAD_REQUEST", error: "userId is required" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const userRes = await admin.auth.admin.getUserById(userId);
    if (userRes.error || !userRes.data.user) {
      return NextResponse.json(
        { code: "USER_NOT_FOUND", error: "User not found" },
        { status: 404 },
      );
    }

    const email = userRes.data.user.email?.trim() ?? "";
    if (!email) {
      return NextResponse.json(
        { code: "USER_EMAIL_MISSING", error: "User has no email address" },
        { status: 409 },
      );
    }

    const { data: existingSub } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    const existingStripeCustomerId =
      (existingSub as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ??
      null;

    const stripe = getStripe();

    let stripeCustomerId = existingStripeCustomerId;
    if (!stripeCustomerId) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      stripeCustomerId = customers.data[0]?.id ?? null;
    }

    if (!stripeCustomerId) {
      return NextResponse.json(
        {
          code: "STRIPE_CUSTOMER_NOT_FOUND",
          error: "No Stripe customer found for this user.",
          userId,
          email,
        },
        { status: 404 },
      );
    }

    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      limit: 10,
    });

    const best = pickBestSubscription(
      subs.data.map((s) => ({ status: s.status, created: s.created })),
    );
    const stripeSubscription =
      best?.created != null
        ? subs.data.find((s) => s.created === best.created && s.status === best.status) ??
          subs.data.find((s) => s.created === best.created) ??
          null
        : null;

    if (!stripeSubscription) {
      return NextResponse.json(
        {
          code: "STRIPE_SUBSCRIPTION_NOT_FOUND",
          error: "No Stripe subscription found for this customer.",
          userId,
          stripeCustomerId,
        },
        { status: 404 },
      );
    }

    const mapped = mapStripeSubscriptionToBillingFields(stripeSubscription, {
      userId,
    });

    if (!mapped.tier || !mapped.interval) {
      return NextResponse.json(
        {
          code: "UNMAPPABLE_SUBSCRIPTION",
          error: "Unable to derive tier/interval from Stripe subscription.",
          userId,
          stripeCustomerId,
          stripeSubscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
        },
        { status: 409 },
      );
    }

    const applied = {
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscription.id,
      tier: mapped.tier,
      interval: mapped.interval,
      status: mapped.status,
      current_period_end:
        mapped.currentPeriodEnd != null
          ? new Date(mapped.currentPeriodEnd * 1000).toISOString()
          : null,
      cancel_at_period_end: mapped.cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    };

    const upsertRes = await admin
      .from("subscriptions")
      .upsert(applied, { onConflict: "user_id" });
    if (upsertRes.error) throw new Error(upsertRes.error.message);

    const auditId = `manual_reconcile_${userId}_${Date.now()}`;
    const eventRes = await admin.from("subscription_events").insert({
      stripe_event_id: auditId,
      event_type: "manual.reconcile",
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscription.id,
      user_id: userId,
      status: mapped.status,
      tier: mapped.tier,
      interval: mapped.interval,
      payload_json: {
        source: "manual.reconcile",
        adminUserId: auth.user!.id,
        userId,
        email,
        stripeCustomerId,
        stripeSubscriptionId: stripeSubscription.id,
        status: mapped.status,
        tier: mapped.tier,
        interval: mapped.interval,
        currentPeriodEnd: mapped.currentPeriodEnd,
        cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
      },
      processed_at: new Date().toISOString(),
    });
    if (eventRes.error) throw new Error(eventRes.error.message);

    return NextResponse.json({
      ok: true,
      userId,
      stripeCustomerId,
      stripeSubscriptionId: stripeSubscription.id,
      applied,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to reconcile billing" },
      { status: 500 },
    );
  }
}

