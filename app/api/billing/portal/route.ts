import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { getStripe } from "@/lib/billing/stripe";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";

export async function POST() {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const stripe = getStripe();
    const rawBase =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const baseUrl = rawBase.replace(/\/+$/, "");

    const billing = await getEffectiveBillingState(supabase, user.id);
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

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/dashboard/overview?billing=portal_return`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Portal failed" },
      { status: 500 },
    );
  }
}
