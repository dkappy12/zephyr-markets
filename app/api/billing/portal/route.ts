import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { getStripe } from "@/lib/billing/stripe";

export async function POST() {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    // Find or create Stripe customer by email for now.
    // Later we’ll replace this with DB-backed customer_id from webhook state.
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

    const customer =
      existing.data[0] ??
      (await stripe.customers.create({
        email,
        metadata: { user_id: user.id },
      }));

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${baseUrl}/dashboard/settings`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Portal failed" },
      { status: 500 },
    );
  }
}
