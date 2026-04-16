import Stripe from "stripe";

/** Pinned Stripe API version (align with the `stripe` npm package major release). */
const STRIPE_API_VERSION = "2026-03-25.dahlia" as const;

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
    });
  }

  return stripeClient;
}
