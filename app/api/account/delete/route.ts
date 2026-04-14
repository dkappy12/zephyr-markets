import { createClient } from "@/lib/supabase/server";
import { logAuthAuditEvent } from "@/lib/auth/audit";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type DeleteErrorCode =
  | "UNAUTHORIZED"
  | "CSRF_BLOCKED"
  | "PASSWORD_REQUIRED"
  | "PASSWORD_INVALID"
  | "SERVER_MISCONFIGURED"
  | "DATA_CLEANUP_FAILED"
  | "AUTH_DELETE_FAILED"
  | "INTERNAL_ERROR";

type DeletionStage = "start" | "cleanup" | "auth_delete" | "complete";

function errorResponse(
  status: number,
  code: DeleteErrorCode,
  error: string,
  details?: string,
) {
  return NextResponse.json(
    details ? { code, error, details } : { code, error },
    { status },
  );
}

function getRequiredEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

async function logDeletionEvent(
  // Supabase generic types are not generated for admin_job_log in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  {
    userId,
    status,
    stage,
    message,
  }: {
    userId: string;
    status: "started" | "succeeded" | "failed";
    stage: DeletionStage;
    message: string;
  },
) {
  const eventTime = new Date().toISOString();
  const payloads = [
    {
      job_name: "account_delete",
      status,
      message,
      metadata: { userId, stage, eventTime },
    },
    {
      event_type: "account_delete",
      status,
      message,
      user_id: userId,
      context: { stage, eventTime },
    },
  ];

  for (const payload of payloads) {
    // admin_job_log is intentionally loosely typed in this project.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (adminClient as any)
      .from("admin_job_log")
      .insert(payload);
    if (!error) return;
  }

  // Keep deletion flow resilient even if audit table shape differs.
  console.error("Failed to write admin_job_log entry", {
    operation: "account_delete",
    userId,
    stage,
    status,
  });
}

export async function DELETE(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  // Verify the user is authenticated
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    await logAuthAuditEvent({
      event: "account_delete_unauthorized",
      status: "failure",
    });
    return errorResponse(401, "UNAUTHORIZED", "Unauthorized");
  }

  const userId = user.id;
  const email = user.email;
  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";

  if (!password.trim()) {
    await logAuthAuditEvent({
      event: "account_delete_password_missing",
      userId,
      status: "failure",
    });
    return errorResponse(400, "PASSWORD_REQUIRED", "Password is required.");
  }

  if (!email) {
    return errorResponse(
      400,
      "PASSWORD_INVALID",
      "Password confirmation is unavailable for this account.",
    );
  }

  const { error: reAuthError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (reAuthError) {
    await logAuthAuditEvent({
      event: "account_delete_password_invalid",
      userId,
      status: "failure",
    });
    return errorResponse(401, "PASSWORD_INVALID", "Invalid password.");
  }

  const env = getRequiredEnv();
  if (!env) {
    console.error("Account deletion misconfigured", {
      operation: "account_delete",
      userId,
      stage: "start",
      reason: "missing_required_env",
    });
    return errorResponse(
      500,
      "SERVER_MISCONFIGURED",
      "Account deletion is temporarily unavailable.",
    );
  }

  try {
    // Delete user data from all tables first
    // Use service role key to bypass RLS
    const adminClient = createAdminClient(env.url, env.serviceRoleKey);
    await logDeletionEvent(adminClient, {
      userId,
      status: "started",
      stage: "start",
      message: "Account deletion requested",
    });

    // Delete in dependency order — child tables first
    for (const table of [
      "alerts",
      "portfolio_pnl",
      "positions",
      "premium_predictions",
      "attribution_predictions",
      "scenario_predictions",
      "signal_predictions",
      "accuracy_metrics",
      "team_members",
    ]) {
      const { error: cleanupError } = await adminClient
        .from(table)
        .delete()
        .eq("user_id", userId);

      if (cleanupError) {
        await logDeletionEvent(adminClient, {
          userId,
          status: "failed",
          stage: "cleanup",
          message: `Cleanup failed at table ${table}`,
        });
        console.error("Account deletion cleanup failed", {
          operation: "account_delete",
          userId,
          stage: "cleanup",
          table,
          reason: cleanupError.message,
        });
        return errorResponse(
          500,
          "DATA_CLEANUP_FAILED",
          `Failed to delete account data (table: ${table}).`,
          cleanupError.message,
        );
      }
    }

    const { error: profileDeleteError } = await adminClient
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (profileDeleteError) {
      await logDeletionEvent(adminClient, {
        userId,
        status: "failed",
        stage: "cleanup",
        message: "Cleanup failed at table profiles",
      });
      console.error("Account deletion cleanup failed", {
        operation: "account_delete",
        userId,
        stage: "cleanup",
        table: "profiles",
        reason: profileDeleteError.message,
      });
      return errorResponse(
        500,
        "DATA_CLEANUP_FAILED",
        "Failed to delete account data (table: profiles).",
        profileDeleteError.message,
      );
    }

    // Finally delete the auth record
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(
      userId,
    );

    if (deleteError) {
      await logDeletionEvent(adminClient, {
        userId,
        status: "failed",
        stage: "auth_delete",
        message: "Failed to delete auth user",
      });
      console.error("Failed to delete auth user", {
        operation: "account_delete",
        userId,
        stage: "auth_delete",
        reason: deleteError.message,
      });
      return errorResponse(500, "AUTH_DELETE_FAILED", "Failed to delete account");
    }

    await logDeletionEvent(adminClient, {
      userId,
      status: "succeeded",
      stage: "complete",
      message: "Account deletion completed",
    });
    await logAuthAuditEvent({
      event: "account_delete_completed",
      userId,
      status: "success",
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Account deletion unexpected error", {
      operation: "account_delete",
      userId,
      stage: "start",
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    return errorResponse(500, "INTERNAL_ERROR", "Failed to delete account");
  }
}
