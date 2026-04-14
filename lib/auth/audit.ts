import { createClient as createAdminClient } from "@supabase/supabase-js";

type AuthAuditInput = {
  event: string;
  userId?: string | null;
  status: "success" | "failure" | "info";
  metadata?: Record<string, unknown>;
};

export async function logAuthAuditEvent(input: AuthAuditInput) {
  const payload = {
    event: input.event,
    userId: input.userId ?? null,
    status: input.status,
    metadata: input.metadata ?? {},
    timestamp: new Date().toISOString(),
  };

  console.info("[auth_audit]", JSON.stringify(payload));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return;

  try {
    const admin = createAdminClient(url, serviceRoleKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from("admin_job_log").insert({
      job_name: "auth_audit",
      status: input.status,
      message: input.event,
      metadata: payload,
    });
  } catch {
    // Keep auth flow resilient even if audit write fails.
  }
}
