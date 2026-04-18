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
  const name = String(input.firstName ?? "").trim();
  const greet = name ? `Hi ${name},` : "Hi,";
  const plan = `${input.tier === "team" ? "Team" : "Pro"} (${input.interval})`;

  const tierLabel = input.tier === "team" ? "Team" : "Pro";
  const subject =
    input.kind === "subscription_started"
      ? `Welcome to Zephyr`
      : input.kind === "subscription_cancelled"
        ? "We're sorry to see you go"
        : "Your Zephyr subscription has been updated";

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://zephyr.markets").replace(/\/+$/, "");
  const manageUrl = `${appUrl}/dashboard/settings`;
  const overviewUrl = `${appUrl}/dashboard/overview`;

  const textLines =
    input.kind === "subscription_started"
      ? [
          greet,
          "",
          `Your Zephyr ${tierLabel} subscription is now active.`,
          "",
          "You have full access to real-time REMIT signals, the physical premium score, morning brief, and portfolio analytics.",
          "",
          "A few things worth knowing:",
          "— Signals update every 5 minutes from Elexon BMRS",
          "— Your morning brief lands at 06:00 GMT every trading day",
          "— Import positions in the Book tab to unlock personalised brief touchpoints",
          "",
          `Open your dashboard: ${overviewUrl}`,
          "",
          "Questions? Reply to this email.",
          "",
          "The Zephyr team",
        ]
      : input.kind === "subscription_cancelled"
        ? [
            greet,
            "",
            "Your Zephyr subscription has been cancelled. You'll retain access until the end of your current billing period.",
            "",
            "If you cancelled by mistake or want to resubscribe, you can do so at any time from your account settings.",
            "",
            "Was there something we could have done better? We'd genuinely like to know: contact@zephyr.markets",
            "",
            `Resubscribe: ${manageUrl}`,
            "",
            "The Zephyr team",
          ]
        : [
            greet,
            "",
            "Your Zephyr subscription was updated.",
            "",
            `Plan: ${plan}`,
            `Status: ${input.status}`,
            "",
            "If you made this change, nothing else is needed. If something looks wrong, reply to this email and we'll sort it out.",
            "",
            `Review your billing: ${manageUrl}`,
            "",
            "The Zephyr team",
          ];

  const text = textLines.join("\n");

  const html =
    input.kind === "subscription_started"
      ? `
    <div style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;color:#2C2A26;max-width:560px">
      <p style="margin:0 0 16px">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px">Your <strong>Zephyr ${escapeHtml(tierLabel)}</strong> subscription is now active.</p>
      <p style="margin:0 0 12px">You have full access to real-time REMIT signals, the physical premium score, morning brief, and portfolio analytics.</p>
      <p style="margin:0 0 8px;font-weight:600">A few things worth knowing:</p>
      <ul style="margin:0 0 16px;padding-left:20px">
        <li style="margin-bottom:6px">Signals update every 5 minutes from Elexon BMRS</li>
        <li style="margin-bottom:6px">Your morning brief lands at 06:00 GMT every trading day</li>
        <li style="margin-bottom:6px">Import positions in the Book tab to unlock personalised brief touchpoints</li>
      </ul>
      <p style="margin:0 0 16px">
        <a href="${escapeHtml(overviewUrl)}" style="color:#7a5f1a;font-weight:600">Open your dashboard →</a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#666">Questions? Reply to this email.</p>
      <p style="margin:0;font-size:13px;color:#666">The Zephyr team</p>
    </div>`
      : input.kind === "subscription_cancelled"
        ? `
    <div style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;color:#2C2A26;max-width:560px">
      <p style="margin:0 0 16px">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px">Your Zephyr subscription has been cancelled. You'll retain access until the end of your current billing period.</p>
      <p style="margin:0 0 16px">If you cancelled by mistake or want to resubscribe, you can do so at any time from your account settings.</p>
      <p style="margin:0 0 16px">Was there something we could have done better? We'd genuinely like to know: <a href="mailto:contact@zephyr.markets" style="color:#7a5f1a">contact@zephyr.markets</a></p>
      <p style="margin:0 0 16px">
        <a href="${escapeHtml(manageUrl)}" style="color:#7a5f1a;font-weight:600">Resubscribe →</a>
      </p>
      <p style="margin:0;font-size:13px;color:#666">The Zephyr team</p>
    </div>`
        : `
    <div style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;color:#2C2A26;max-width:560px">
      <p style="margin:0 0 16px">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px">Your Zephyr subscription was updated.</p>
      <p style="margin:0 0 6px"><strong>Plan:</strong> ${escapeHtml(plan)}</p>
      <p style="margin:0 0 16px"><strong>Status:</strong> ${escapeHtml(input.status)}</p>
      <p style="margin:0 0 16px">If you made this change, nothing else is needed. If something looks wrong, reply to this email and we'll sort it out.</p>
      <p style="margin:0 0 16px">
        <a href="${escapeHtml(manageUrl)}" style="color:#7a5f1a;font-weight:600">Review your billing →</a>
      </p>
      <p style="margin:0;font-size:13px;color:#666">The Zephyr team</p>
    </div>`;

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

