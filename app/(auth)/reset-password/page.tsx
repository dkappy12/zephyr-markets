"use client";

import { createClient } from "@/lib/supabase/client";
import { passwordPolicyHint, validatePasswordPolicy } from "@/lib/auth/password-policy";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function friendlyResetPasswordError(message: string): string {
    const m = message.toLowerCase();
    if (
      m.includes("different from the old password") ||
      m.includes("same as the old password") ||
      m.includes("new password should be different")
    ) {
      return "Choose a new password that is different from your current password.";
    }
    if (
      m.includes("expired") ||
      m.includes("invalid") ||
      m.includes("token") ||
      m.includes("session")
    ) {
      return "Reset link is invalid or expired. Request a new one.";
    }
    return "Could not reset password.";
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const policy = validatePasswordPolicy(password);
    if (!policy.ok) {
      setError(`Password policy: ${policy.reasons.join(" ")}`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const policyResp = await fetch("/api/auth/password-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!policyResp.ok) {
        const body = await policyResp.json().catch(() => ({}));
        setError(
          Array.isArray(body?.reasons)
            ? `Password policy: ${body.reasons.join(" ")}`
            : "Password does not meet policy requirements.",
        );
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError(friendlyResetPasswordError(updateError.message ?? ""));
        return;
      }
      setInfo("Password updated.");
      router.push("/login");
    } catch {
      setError("Could not reset password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-[420px] rounded-[4px] border-[0.5px] border-ivory-border bg-card px-8 py-9"
      >
        <h1 className="font-serif text-3xl text-ink">Set new password.</h1>
        <p className="mt-2 text-sm text-ink-mid">
          Choose a new password for your account.
        </p>
        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="password"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
            >
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-2 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-light focus:border-ink/40"
            />
            <p className="mt-2 text-xs text-ink-light">{passwordPolicyHint()}</p>
          </div>
          <div>
            <label
              htmlFor="confirmPassword"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="mt-2 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-light focus:border-ink/40"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-[4px] bg-ink py-3 text-xs font-semibold tracking-[0.06em] text-ivory transition-colors duration-200 hover:bg-[#1f1d1a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Updating..." : "Update password"}
          </button>
        </form>
        {error ? (
          <p className="mt-4 text-sm text-bear" role="alert">
            {error}
          </p>
        ) : null}
        {info ? (
          <p className="mt-4 text-sm text-ink-mid" role="status">
            {info}
          </p>
        ) : null}
        <p className="mt-6 text-xs text-ink-mid">
          Need a new reset link?{" "}
          <Link
            href="/forgot-password"
            className="underline-offset-4 hover:underline"
          >
            Request one
          </Link>
          .
        </p>
      </motion.div>
    </div>
  );
}
