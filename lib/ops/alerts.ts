type AlertSeverity = "info" | "warning" | "critical";

type AlertInput = {
  severity: AlertSeverity;
  title: string;
  details?: Record<string, unknown>;
};

export async function sendOpsAlert(input: AlertInput): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;

  const body = {
    text: `[${input.severity.toUpperCase()}] ${input.title}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${input.title}*\nSeverity: \`${input.severity}\``,
        },
      },
      ...(input.details
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "```" + JSON.stringify(input.details, null, 2) + "```",
              },
            },
          ]
        : []),
    ],
  };

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Keep core request paths resilient if Slack is down.
  }
}
