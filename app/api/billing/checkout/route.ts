import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { getStripe } from "@/lib/billing/stripe";

type BillingInterval = "monthly" | "annual";
type Tier = "pro" | "team";

function getPriceId(tier: Tier, interval: BillingInterval): string {
  if (tier === "pro" && interval === "monthly") {
    return process.env.STRIPE_PRICE_PRO_MONTHLY ?? "";
  }
  if (tier === "pro" && interval === "annual") {
    return process.env.STRIPE_PRICE_PRO_ANNUAL ?? "";
  }
  if (tier === "team" && interval === "monthly") {
    return process.env.STRIPE_PRICE_TEAM_MONTHLY ?? "";
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      tier?: Tier;
      interval?: BillingInterval;
    };

    const tier = body.tier;
    const interval = body.interval;

    if (!tier || !interval) {
      return NextResponse.json(
        { error: "tier and interval are required" },
        { status: 400 },
      );
    }

    if (tier === "team" && interval === "annual") {
      return NextResponse.json(
        { error: "Team annual is not available yet" },
        { status: 400 },
      );
    }

    const priceId = getPriceId(tier, interval);
    if (!priceId) {
      return NextResponse.json(
        { error: "Missing Stripe price configuration" },
        { status: 500 },
      );
    }

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard/settings?billing=success`,
      cancel_url: `${baseUrl}/dashboard/settings?billing=cancelled`,
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        tier,
        interval,
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout failed" },
      { status: 500 },
    );
  }
}
