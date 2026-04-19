"use client";

import { TopoBackground } from "@/components/ui/TopoBackground";
import { createClient } from "@/lib/supabase/client";
import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: origin ? `${origin}/reset-password` : undefined,
        },
      );
      if (resetError) {
        setError("Could not send password reset email.");
        return;
      }
      setInfo(
        "If an account exists for this email, a password reset link has been sent.",
      );
    } catch {
      setError("Could not send password reset email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ivory px-4 py-16">
      <TopoBackground className="absolute inset-0 h-full w-full" lineOpacity={0.15} />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-[420px] rounded-[4px] border-[0.5px] border-ivory-border bg-card px-8 py-9"
      >
        <h1 className="font-serif text-3xl text-ink">Reset password.</h1>
        <p className="mt-2 text-sm text-ink-mid">
          Enter your account email and we&apos;ll send a reset link.
        </p>
        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="email"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-2 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-light focus:border-ink/40"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-[4px] bg-ink py-3 text-xs font-semibold tracking-[0.06em] text-ivory transition-colors duration-200 hover:bg-[#1f1d1a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send reset link"}
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
          <Link href="/login" className="underline-offset-4 hover:underline">
            Back to login
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
