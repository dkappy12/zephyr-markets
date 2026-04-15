import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/billing/stripe";

export const runtime = "nodejs";

type Tier = "pro" | "team";
type BillingInterval = "monthly" | "annual";

function toBillingInterval(
  interval: Stripe.Price.Recurring.Interval | null | undefined,
): BillingInterval {
  return interval === "year" ? "annual" : "monthly";
}

function tierFromPriceId(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null;
  if (
    priceId === process.env.STRIPE_PRICE_PRO_MONTHLY ||
    priceId === process.env.STRIPE_PRICE_PRO_ANNUAL
  ) {
    return "pro";
  }
  if (priceId === process.env.STRIPE_PRICE_TEAM_MONTHLY) {
    return "team";
  }
  return null;
}

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Missing Supabase admin env vars");
  }
  return createAdminClient(url, serviceRole);
}

function coerceTier(value: string | undefined): Tier | null {
  if (!value) return null;
  return value === "pro" || value === "team" ? value : null;
}

function coerceInterval(value: string | undefined): BillingInterval | null {
  if (!value) return null;
  return value === "annual" || value === "monthly" ? value : null;
}

function readSubscriptionPeriodEnd(
  sub: Stripe.Subscription | Stripe.Response<Stripe.Subscription>,
): number | null {
  const raw = sub as unknown as Record<string, unknown>;
  const value = raw.current_period_end ?? raw.currentPeriodEnd;
  return typeof value === "number" ? value : null;
}

function readCancelAtPeriodEnd(
  sub: Stripe.Subscription | Stripe.Response<Stripe.Subscription>,
): boolean {
  const raw = sub as unknown as Record<string, unknown>;
  const value = raw.cancel_at_period_end ?? raw.cancelAtPeriodEnd;
  return typeof value === "boolean" ? value : false;
}

async function upsertSubscriptionRow(input: {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  tier: Tier;
  interval: BillingInterval;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}) {
  const admin = getAdminSupabase();
  const payload = {
    user_id: input.userId,
    stripe_customer_id: input.stripeCustomerId,
    stripe_subscription_id: input.stripeSubscriptionId,
    tier: input.tier,
    interval: input.interval,
    status: input.status,
    current_period_end:
      input.currentPeriodEnd != null
        ? new Date(input.currentPeriodEnd * 1000).toISOString()
        : null,
    cancel_at_period_end: input.cancelAtPeriodEnd,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("subscriptions")
    .upsert(payload, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

async function resolveUserIdFromCustomer(
  stripeCustomerId: string,
): Promise<string | null> {
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
}

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Missing STRIPE_WEBHOOK_SECRET" },
      { status: 500 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid webhook signature" },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const stripeSubscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        const stripeCustomerId =
          typeof session.customer === "string" ? session.customer : null;
        if (!stripeSubscriptionId || !stripeCustomerId) {
          throw new Error("Checkout session missing subscription/customer id");
        }

        const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const firstPrice = sub.items.data[0]?.price;
        const tier =
          coerceTier(sub.metadata?.tier) ??
          coerceTier(session.metadata?.tier) ??
          tierFromPriceId(firstPrice?.id);
        const interval =
          coerceInterval(sub.metadata?.interval) ??
          coerceInterval(session.metadata?.interval) ??
          toBillingInterval(firstPrice?.recurring?.interval);
        const userId =
          session.metadata?.user_id ??
          session.client_reference_id ??
          sub.metadata?.user_id ??
          null;

        if (!userId || !tier || !interval) {
          throw new Error("Unable to resolve user/tier/interval for checkout");
        }

        await upsertSubscriptionRow({
          userId,
          stripeCustomerId,
          stripeSubscriptionId,
          tier,
          interval,
          status: sub.status,
          currentPeriodEnd: readSubscriptionPeriodEnd(sub),
          cancelAtPeriodEnd: readCancelAtPeriodEnd(sub),
        });
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const stripeSubscriptionId = sub.id;
        const stripeCustomerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const firstPrice = sub.items.data[0]?.price;

        const tier =
          coerceTier(sub.metadata?.tier) ?? tierFromPriceId(firstPrice?.id);
        const interval =
          coerceInterval(sub.metadata?.interval) ??
          toBillingInterval(firstPrice?.recurring?.interval);
        const userId =
          sub.metadata?.user_id ??
          (await resolveUserIdFromCustomer(stripeCustomerId));

        if (!userId || !tier || !interval) {
          throw new Error(
            "Unable to resolve user/tier/interval for subscription update",
          );
        }

        await upsertSubscriptionRow({
          userId,
          stripeCustomerId,
          stripeSubscriptionId,
          tier,
          interval,
          status: sub.status,
          currentPeriodEnd: readSubscriptionPeriodEnd(sub),
          cancelAtPeriodEnd: readCancelAtPeriodEnd(sub),
        });
        break;
      }

      default:
        break;
    }
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Webhook processing failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    received: true,
    eventType: event.type,
    eventId: event.id,
  });
}
