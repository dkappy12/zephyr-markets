import type Stripe from "stripe";

export type Tier = "pro" | "team";
export type BillingInterval = "monthly" | "annual";

export function toBillingInterval(
  interval: Stripe.Price.Recurring.Interval | null | undefined,
): BillingInterval {
  return interval === "year" ? "annual" : "monthly";
}

export function tierFromPriceId(priceId: string | null | undefined): Tier | null {
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

export function coerceTier(value: string | undefined): Tier | null {
  if (!value) return null;
  return value === "pro" || value === "team" ? value : null;
}

export function coerceInterval(value: string | undefined): BillingInterval | null {
  if (!value) return null;
  return value === "annual" || value === "monthly" ? value : null;
}

export function readSubscriptionPeriodEnd(
  sub: Stripe.Subscription | Stripe.Response<Stripe.Subscription>,
): number | null {
  const raw = sub as unknown as Record<string, unknown>;
  const primary = raw.current_period_end ?? raw.currentPeriodEnd;
  if (typeof primary === "number") return primary;
  if (typeof primary === "string") {
    const parsed = Number(primary);
    if (Number.isFinite(parsed)) return parsed;
  }

  const items = raw.items as { data?: Array<Record<string, unknown>> } | undefined;
  const firstItem = items?.data?.[0];
  const fallback = firstItem?.current_period_end ?? firstItem?.currentPeriodEnd;
  if (typeof fallback === "number") return fallback;
  if (typeof fallback === "string") {
    const parsed = Number(fallback);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function readCancelAtPeriodEnd(
  sub: Stripe.Subscription | Stripe.Response<Stripe.Subscription>,
): boolean {
  const raw = sub as unknown as Record<string, unknown>;
  const value = raw.cancel_at_period_end ?? raw.cancelAtPeriodEnd;
  return typeof value === "boolean" ? value : false;
}

export function mapStripeSubscriptionToBillingFields(
  sub: Stripe.Subscription | Stripe.Response<Stripe.Subscription>,
  fallback?: {
    tier?: string | null;
    interval?: string | null;
    userId?: string | null;
  },
) {
  const firstPrice = (sub as Stripe.Subscription).items?.data?.[0]?.price;

  const tier =
    coerceTier(sub.metadata?.tier) ??
    coerceTier(fallback?.tier ?? undefined) ??
    tierFromPriceId(firstPrice?.id);

  const interval =
    coerceInterval(sub.metadata?.interval) ??
    coerceInterval(fallback?.interval ?? undefined) ??
    toBillingInterval(firstPrice?.recurring?.interval);

  const userId = sub.metadata?.user_id ?? fallback?.userId ?? null;

  return {
    userId,
    tier,
    interval,
    status: (sub as Stripe.Subscription).status,
    currentPeriodEnd: readSubscriptionPeriodEnd(sub),
    cancelAtPeriodEnd: readCancelAtPeriodEnd(sub),
    stripeSubscriptionId: (sub as Stripe.Subscription).id,
    stripeCustomerId: (() => {
      const customer = (sub as Stripe.Subscription).customer;
      if (typeof customer === "string") return customer;
      if (customer && typeof customer === "object" && "id" in customer) {
        return String((customer as { id?: string }).id ?? "");
      }
      return null;
    })(),
  };
}

