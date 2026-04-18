import { Resend } from "resend";

export type BillingLifecycleEmailKind =
  | "subscription_started"
  | "subscription_updated"
  | "subscription_cancelled";

export async function sendBillingLifecycleEmail(input: {
  to: string;
  firstName?: string | null;
  kind: BillingLifecycleEmailKind;
  tier: "pro" | "team";
  interval: "monthly" | "annual";
  status: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { sent: false, skipped: true as const };
  }

  const from = process.env.RESEND_FROM?.trim() || "Zephyr <noreply@zephyr.markets>";
  const replyTo = process.env.RESEND_REPLY_TO?.trim() || "contact@zephyr.markets";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://zephyr.markets").replace(
    /\/+$/,
    "",
  );
  const manageUrl = `${appUrl}/dashboard/overview`;
  const name = String(input.firstName ?? "").trim();
  const greet = name ? `Hi ${name},` : "Hi,";
  const plan = `${input.tier === "team" ? "Team" : "Pro"} (${input.interval})`;

  const subject =
    input.kind === "subscription_started"
      ? "Thank you — your Zephyr subscription is active"
      : input.kind === "subscription_cancelled"
        ? "Your Zephyr subscription was updated"
        : "Your Zephyr billing details were updated";

  const textLines =
    input.kind === "subscription_started"
      ? [
          greet,
          "",
          "Thank you for subscribing to Zephyr.",
          `Current plan: ${plan}.`,
          "You will receive confirmation emails for any billing changes to this address.",
          "",
          `You can manage your billing anytime: ${manageUrl}`,
        ]
      : input.kind === "subscription_cancelled"
        ? [
            greet,
            "",
            "Your subscription status was updated in Zephyr.",
            `Current status: ${input.status}.`,
            `Current plan: ${plan}.`,
            "Stripe will email any relevant invoice/receipt updates.",
            "",
            `Review account billing: ${manageUrl}`,
          ]
        : [
            greet,
            "",
            "Your Zephyr subscription details were updated.",
            `Current status: ${input.status}.`,
            `Current plan: ${plan}.`,
            "Stripe will email your latest invoice/receipt where applicable.",
            "",
            `Review account billing: ${manageUrl}`,
          ];

  const text = textLines.join("\n");

  const html = `
    <div style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.5;color:#2C2A26;max-width:560px">
      <p style="margin:0 0 12px">${escapeHtml(greet)}</p>
      <p style="margin:0 0 12px">
        ${
          input.kind === "subscription_started"
            ? "Thank you for subscribing to <strong>Zephyr</strong>."
            : "Your Zephyr billing details were updated."
        }
      </p>
      <p style="margin:0 0 12px"><strong>Plan:</strong> ${escapeHtml(plan)}</p>
      <p style="margin:0 0 12px"><strong>Status:</strong> ${escapeHtml(input.status)}</p>
      <p style="margin:0 0 16px">You will receive a confirmation email for this change.</p>
      <p style="margin:0 0 8px">
        <a href="${escapeHtml(manageUrl)}" style="color:#7a5f1a;font-weight:600">Open billing overview</a>
      </p>
    </div>
  `;

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: input.to,
    replyTo,
    subject,
    text,
    html,
  });

  if (error) return { sent: false, error: error.message };
  return { sent: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

