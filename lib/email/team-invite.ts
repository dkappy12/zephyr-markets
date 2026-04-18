import { Resend } from "resend";

export type TeamInviteEmailResult = {
  sent: boolean;
  skipped?: boolean;
  error?: string;
};

/** Default outbound sender (domain must be verified in Resend). */
export const DEFAULT_RESEND_FROM = "Zephyr <noreply@zephyr.markets>";

/**
 * Replies go here so they’re not lost (matches Cloudflare routing for contact@).
 * Override with RESEND_REPLY_TO.
 */
export const DEFAULT_RESEND_REPLY_TO = "contact@zephyr.markets";

/**
 * Sends team invite email via Resend.
 * - `RESEND_API_KEY` — required to send (set in Vercel + `.env.local`).
 * - `RESEND_FROM` — optional; defaults to {@link DEFAULT_RESEND_FROM}.
 * - `RESEND_REPLY_TO` — optional; defaults to {@link DEFAULT_RESEND_REPLY_TO}.
 */
export async function sendTeamInviteEmail(params: {
  to: string;
  inviteUrl: string;
  teamName: string;
}): Promise<TeamInviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[team-invite-email] RESEND_API_KEY not set; invite email not sent",
    );
    return { sent: false, skipped: true };
  }

  const from = process.env.RESEND_FROM?.trim() || DEFAULT_RESEND_FROM;
  const replyTo =
    process.env.RESEND_REPLY_TO?.trim() || DEFAULT_RESEND_REPLY_TO;

  const subject = `You've been invited to join ${params.teamName} on Zephyr`;

  const text = [
    `You've been invited to join ${params.teamName} on Zephyr.`,
    "",
    "Zephyr is a GB power and European gas trading intelligence platform — real-time REMIT signals, physical premium scoring, and portfolio analytics built for professional energy traders.",
    "",
    "Accept your invitation (sign in with this email address first):",
    params.inviteUrl,
    "",
    "If you weren't expecting this, you can safely ignore this email.",
    "",
    "The Zephyr team",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;color:#2C2A26;max-width:520px">
      <p style="margin:0 0 16px">You've been invited to join <strong>${escapeHtml(params.teamName)}</strong> on Zephyr.</p>
      <p style="margin:0 0 16px">Zephyr is a GB power and European gas trading intelligence platform — real-time REMIT signals, physical premium scoring, and portfolio analytics built for professional energy traders.</p>
      <p style="margin:0 0 20px">Accept your invitation using the link below. Make sure you're signed in with this email address first.</p>
      <p style="margin:0 0 24px">
        <a href="${escapeHtml(params.inviteUrl)}" style="color:#7a5f1a;font-weight:600">Accept invitation →</a>
      </p>
      <p style="margin:0;font-size:13px;color:#666">If you weren't expecting this, you can safely ignore this email.</p>
      <p style="margin:0;font-size:13px;color:#666">The Zephyr team</p>
    </div>`;

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: params.to,
    replyTo,
    subject,
    text,
    html,
  });

  if (error) {
    console.error("[team-invite-email] Resend error:", error);
    return { sent: false, error: error.message };
  }

  return { sent: true, skipped: false };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
