import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/billing/stripe";
import {
  sendBillingLifecycleEmail,
  type BillingLifecycleEmailKind,
} from "@/lib/email/billing-lifecycle";
import {
  coerceInterval,
  coerceTier,
  mapStripeSubscriptionToBillingFields,
  readCancelAtPeriodEnd,
  readSubscriptionPeriodEnd,
  tierFromPriceId,
  toBillingInterval,
  type BillingInterval,
  type Tier,
} from "@/lib/billing/stripe-subscription-mapper";
import { logEvent } from "@/lib/ops/logger";

export const runtime = "nodejs";

type LedgerContext = {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  userId: string | null;
  status: string | null;
  tier: Tier | null;
  interval: BillingInterval | null;
};

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Missing Supabase admin env vars");
  }
  return createAdminClient(url, serviceRole);
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

function deriveLedgerContext(event: Stripe.Event): LedgerContext {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const stripeSubscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null;
    const stripeCustomerId =
      typeof session.customer === "string" ? session.customer : null;
    return {
      stripeCustomerId,
      stripeSubscriptionId,
      userId: session.metadata?.user_id ?? session.client_reference_id ?? null,
      status: null,
      tier: coerceTier(session.metadata?.tier),
      interval: coerceInterval(session.metadata?.interval),
    };
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const stripeCustomerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const firstPrice = sub.items.data[0]?.price;
    return {
      stripeCustomerId,
      stripeSubscriptionId: sub.id,
      userId: sub.metadata?.user_id ?? null,
      status: sub.status,
      tier: coerceTier(sub.metadata?.tier) ?? tierFromPriceId(firstPrice?.id),
      interval:
        coerceInterval(sub.metadata?.interval) ??
        toBillingInterval(firstPrice?.recurring?.interval),
    };
  }

  return {
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    userId: null,
    status: null,
    tier: null,
    interval: null,
  };
}

async function resolveUserEmailContext(userId: string): Promise<{
  email: string | null;
  firstName: string | null;
}> {
  try {
    const admin = getAdminSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any).auth.admin.getUserById(userId);
    if (error || !data?.user) return { email: null, firstName: null };
    const email = String(data.user.email ?? "").trim() || null;
    const full = String(data.user.user_metadata?.full_name ?? "").trim();
    const firstName = full ? full.split(/\s+/)[0] ?? null : null;
    return { email, firstName };
  } catch {
    return { email: null, firstName: null };
  }
}

async function sendLifecycleEmailBestEffort(input: {
  userId: string | null;
  kind: BillingLifecycleEmailKind;
  tier: Tier | null;
  interval: BillingInterval | null;
  status: string;
  eventId: string;
}) {
  if (!input.userId || !input.tier || !input.interval) return;
  const userCtx = await resolveUserEmailContext(input.userId);
  if (!userCtx.email) return;
  try {
    const result = await sendBillingLifecycleEmail({
      to: userCtx.email,
      firstName: userCtx.firstName,
      kind: input.kind,
      tier: input.tier,
      interval: input.interval,
      status: input.status,
    });
    logEvent({
      scope: "billing_webhook",
      event: "billing_lifecycle_email_result",
      data: {
        eventId: input.eventId,
        userId: input.userId,
        kind: input.kind,
        sent: result.sent,
        skipped: "skipped" in result ? !!result.skipped : false,
        error: "error" in result ? result.error : null,
      },
    });
  } catch (e: unknown) {
    logEvent({
      scope: "billing_webhook",
      event: "billing_lifecycle_email_failed",
      level: "warn",
      data: {
        eventId: input.eventId,
        userId: input.userId,
        kind: input.kind,
        error: e instanceof Error ? e.message : "Email send failed",
      },
    });
  }
}

async function persistWebhookEvent(
  event: Stripe.Event,
  context: LedgerContext,
): Promise<{ shouldProcess: boolean }> {
  const admin = getAdminSupabase();
  const { data: existing, error: selectError } = await admin
    .from("subscription_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .limit(1)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (existing) return { shouldProcess: false };

  const { error: insertError } = await admin.from("subscription_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_customer_id: context.stripeCustomerId,
    stripe_subscription_id: context.stripeSubscriptionId,
    user_id: context.userId,
    status: context.status,
    tier: context.tier,
    interval: context.interval,
    payload_json: event,
    processed_at: new Date().toISOString(),
  });
  if (insertError) {
    const message = insertError.message ?? "";
    if (
      message.toLowerCase().includes("duplicate key") ||
      message.includes("stripe_event_id")
    ) {
      return { shouldProcess: false };
    }
    throw new Error(message || "Failed to persist webhook event");
  }
  return { shouldProcess: true };
}

async function markWebhookEventFailed(input: {
  event: Stripe.Event;
  context: LedgerContext;
  error: string;
}) {
  try {
    const admin = getAdminSupabase();
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("subscription_events" as any)
      .update({
        payload_json: {
          ...(input.event as unknown as Record<string, unknown>),
          _processing: {
            state: "failed",
            failed_at: new Date().toISOString(),
            error: input.error,
            context: input.context,
          },
        },
      })
      .eq("stripe_event_id", input.event.id);
  } catch {
    // Never block webhook response on failure instrumentation.
  }
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
  logEvent({
    scope: "billing_webhook",
    event: "stripe_event_received",
    data: {
      eventId: event.id,
      eventType: event.type,
    },
  });
  const ledgerContext = deriveLedgerContext(event);

  try {
    const persisted = await persistWebhookEvent(event, ledgerContext);
    if (!persisted.shouldProcess) {
      logEvent({
        scope: "billing_webhook",
        event: "stripe_event_duplicate_skipped",
        data: {
          eventId: event.id,
          eventType: event.type,
          stripeCustomerId: ledgerContext.stripeCustomerId,
          stripeSubscriptionId: ledgerContext.stripeSubscriptionId,
          userId: ledgerContext.userId,
        },
      });
      return NextResponse.json({
        received: true,
        eventType: event.type,
        eventId: event.id,
        duplicate: true,
      });
    }

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
        const mapped = mapStripeSubscriptionToBillingFields(sub, {
          tier: session.metadata?.tier ?? null,
          interval: session.metadata?.interval ?? null,
          userId:
            session.metadata?.user_id ??
            session.client_reference_id ??
            sub.metadata?.user_id ??
            null,
        });
        const tier = mapped.tier;
        const interval = mapped.interval;
        const userId = mapped.userId;

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
        logEvent({
          scope: "billing_webhook",
          event: "checkout_session_synced",
          data: {
            eventId: event.id,
            stripeSubscriptionId,
            stripeCustomerId,
            userId,
            tier,
            interval,
            status: sub.status,
            currentPeriodEnd: readSubscriptionPeriodEnd(sub),
          },
        });
        await sendLifecycleEmailBestEffort({
          eventId: event.id,
          userId,
          kind: "subscription_started",
          tier,
          interval,
          status: sub.status,
        });
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const stripeSubscriptionId = sub.id;
        const stripeCustomerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const mapped = mapStripeSubscriptionToBillingFields(sub, {
          userId: sub.metadata?.user_id ?? null,
        });
        const tier = mapped.tier;
        const interval = mapped.interval;
        const userId =
          mapped.userId ?? (await resolveUserIdFromCustomer(stripeCustomerId));

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
        logEvent({
          scope: "billing_webhook",
          event: "subscription_state_synced",
          data: {
            eventId: event.id,
            eventType: event.type,
            stripeSubscriptionId,
            stripeCustomerId,
            userId,
            tier,
            interval,
            status: sub.status,
            currentPeriodEnd: readSubscriptionPeriodEnd(sub),
          },
        });
        await sendLifecycleEmailBestEffort({
          eventId: event.id,
          userId,
          kind:
            event.type === "customer.subscription.deleted"
              ? "subscription_cancelled"
              : "subscription_updated",
          tier,
          interval,
          status: sub.status,
        });
        break;
      }

      default:
        logEvent({
          scope: "billing_webhook",
          event: "stripe_event_processed",
          data: {
            eventId: event.id,
            eventType: event.type,
            handled: false,
          },
        });
        break;
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "Webhook processing failed";
    await markWebhookEventFailed({ event, context: ledgerContext, error });
    logEvent({
      scope: "billing_webhook",
      event: "stripe_event_failed",
      level: "error",
      data: {
        eventId: event.id,
        eventType: event.type,
        error,
        stripeCustomerId: ledgerContext.stripeCustomerId,
        stripeSubscriptionId: ledgerContext.stripeSubscriptionId,
        userId: ledgerContext.userId,
        status: ledgerContext.status,
        tier: ledgerContext.tier,
        interval: ledgerContext.interval,
      },
    });
    return NextResponse.json(
      { error },
      { status: 500 },
    );
  }

  return NextResponse.json({
    received: true,
    eventType: event.type,
    eventId: event.id,
    duplicate: false,
  });
}
