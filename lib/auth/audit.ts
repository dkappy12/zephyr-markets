import { createClient as createAdminClient } from "@supabase/supabase-js";
import { sendOpsAlert } from "@/lib/ops/alerts";
import { logEvent } from "@/lib/ops/logger";

type AuthAuditInput = {
  event: string;
  userId?: string | null;
  status: "success" | "failure" | "info";
  metadata?: Record<string, unknown>;
};

export async function logAuthAuditEvent(input: AuthAuditInput) {
  const payload: Record<string, unknown> = {
    event: input.event,
    userId: input.userId ?? null,
    status: input.status,
    metadata: input.metadata ?? {},
    timestamp: new Date().toISOString(),
  };

  logEvent({
    scope: "auth_audit",
    event: input.event,
    level: input.status === "failure" ? "warn" : "info",
    data: payload,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return;

  try {
    const admin = createAdminClient(url, serviceRoleKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from("auth_audit_log").insert({
      event: input.event,
      user_id: input.userId ?? null,
      status: input.status,
      metadata: {
        ...(input.metadata ?? {}),
        _logged_at: payload.timestamp,
      },
    });
  } catch {
    await sendOpsAlert({
      severity: "warning",
      title: "auth_audit_log write failed",
      details: {
        event: input.event,
        status: input.status,
      },
    });
    // Keep auth flow resilient even if audit write fails.
  }
}
