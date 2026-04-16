import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { getStripe } from "@/lib/billing/stripe";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { getAppBaseUrl } from "@/lib/team/invite-url";

export async function POST(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const stripe = getStripe();
    const baseUrl = getAppBaseUrl(req);
    const body = (await req.json().catch(() => ({}))) as { mode?: "manage" | "update_subscription" };
    const requestedMode = body.mode ?? "update_subscription";

    const billing = await getEffectiveBillingState(supabase, user.id);
    if (billing.teamMemberOfOwnerId) {
      return NextResponse.json(
        {
          error:
            "Billing is managed by your team owner. Leave the team in Settings → Team if you need your own subscription.",
        },
        { status: 403 },
      );
    }
    const customerId = billing.stripeCustomerId;
    if (!customerId) {
      return NextResponse.json(
        {
          code: "STRIPE_CUSTOMER_MISSING",
          error:
            "No Stripe customer is linked to your account yet. Complete checkout once so we can open the billing portal, or ask an admin to run billing reconcile if you already paid.",
        },
        { status: 409 },
      );
    }

    const returnUrl = `${baseUrl}/dashboard/overview`;
    const session =
      requestedMode === "update_subscription" && billing.stripeSubscriptionId
        ? await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
            flow_data: {
              type: "subscription_update",
              subscription_update: {
                subscription: billing.stripeSubscriptionId,
              },
              after_completion: {
                type: "redirect",
                redirect: { return_url: returnUrl },
              },
            },
          })
        : await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
          });

    return NextResponse.json({ url: session.url });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Portal failed" },
      { status: 500 },
    );
  }
}
