import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { getStripe } from "@/lib/billing/stripe";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { getAppBaseUrl } from "@/lib/team/invite-url";

type PortalMode = "manage" | "update_subscription" | "cancel_subscription";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const stripe = getStripe();
    const baseUrl = getAppBaseUrl(req);
    const body = (await req.json().catch(() => ({}))) as { mode?: PortalMode };
    const mode = body.mode ?? "manage";

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
    let customerId = billing.stripeCustomerId;
    if (!customerId) {
      const email = user.email ?? "";
      if (!email) {
        return NextResponse.json(
          { error: "No email on user account" },
          { status: 400 },
        );
      }

      const existing = await stripe.customers.list({
        email,
        limit: 1,
      });
      customerId =
        existing.data[0]?.id ??
        (
          await stripe.customers.create({
            email,
            metadata: { user_id: user.id },
          })
        ).id;
    }

    const returnUrl = `${baseUrl}/dashboard/overview?billing=billing_updated`;
    const session =
      mode === "update_subscription"
        ? await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
            flow_data: {
              type: "subscription_update",
              after_completion: {
                type: "redirect",
                redirect: {
                  return_url: returnUrl,
                },
              },
            },
          })
        : mode === "cancel_subscription"
          ? await stripe.billingPortal.sessions.create({
              customer: customerId,
              return_url: returnUrl,
              flow_data: {
                type: "subscription_cancel",
                after_completion: {
                  type: "redirect",
                  redirect: {
                    return_url: `${baseUrl}/dashboard/overview?billing=billing_cancelled`,
                  },
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
