/**
 * Starts Stripe Checkout for a new subscription and redirects the browser.
 */
export async function startStripeSubscriptionCheckout(args: {
  tier: "pro" | "team";
  interval: "monthly" | "annual";
}): Promise<void> {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: args.tier, interval: args.interval }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!res.ok || !body.url) {
    throw new Error(body.error ?? "Could not start checkout.");
  }
  window.location.assign(body.url);
}
