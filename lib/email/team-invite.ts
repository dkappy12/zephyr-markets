import { Resend } from "resend";

export type TeamInviteEmailResult = { sent: boolean; skipped?: boolean; error?: string };

/**
 * Sends team invite email from noreply@zephyr.markets (configure RESEND_FROM + domain in Resend).
 * If RESEND_API_KEY is missing, logs and returns skipped — invite row is still created.
 */
export async function sendTeamInviteEmail(params: {
  to: string;
  inviteUrl: string;
  teamName: string;
}): Promise<TeamInviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "[team-invite-email] RESEND_API_KEY not set; invite email not sent",
    );
    return { sent: false, skipped: true };
  }

  const from =
    process.env.RESEND_FROM ?? "Zephyr <noreply@zephyr.markets>";

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: params.to,
    subject: "You're invited to a Zephyr team",
    html: `
      <div style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.5;color:#2C2A26;max-width:520px">
        <p style="font-size:18px;margin:0 0 12px">You're invited</p>
        <p style="margin:0 0 16px">You've been invited to join <strong>${escapeHtml(
          params.teamName,
        )}</strong> on Zephyr.</p>
        <p style="margin:0 0 20px">Open the link below while signed in with this email address to accept:</p>
        <p style="margin:0 0 24px"><a href="${escapeHtml(
          params.inviteUrl,
        )}" style="color:#7a5f1a;font-weight:600">Accept invitation</a></p>
        <p style="font-size:13px;color:#666;margin:0">If you didn't expect this, you can ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    console.error("[team-invite-email]", error);
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
