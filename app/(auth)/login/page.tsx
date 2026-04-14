"use client";

import { createClient } from "@/lib/supabase/client";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error");
    if (errorCode === "auth_unavailable") {
      setInfo("Authentication is temporarily unavailable. Please try again shortly.");
      return;
    }
    if (errorCode === "auth") {
      setInfo("Your sign-in link is invalid or has expired.");
      return;
    }
    setInfo(null);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError("Invalid email or password.");
        return;
      }

      router.push("/dashboard/overview");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[400px] rounded-[4px] border-[0.5px] border-ivory-border bg-card px-8 py-9"
      >
        <h1 className="font-serif text-3xl text-ink">Welcome back.</h1>
        <p className="mt-2 text-sm text-ink-mid">
          Sign in to continue to your intelligence workspace.
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
              className="mt-2 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none ring-0 placeholder:text-ink-light focus:border-ink/40"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-2 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-light focus:border-ink/40"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-[4px] bg-ink py-3 text-xs font-semibold tracking-[0.06em] text-ivory transition-colors duration-200 hover:bg-[#1f1d1a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
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
        <div className="mt-5 flex items-center justify-between text-xs text-ink-mid">
          <Link href="/forgot-password" className="underline-offset-4 hover:underline">
            Forgot password?
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/terms" className="underline-offset-4 hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="underline-offset-4 hover:underline">
              Privacy
            </Link>
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-ink-mid">
          No account?{" "}
          <Link
            href="/signup"
            className="font-medium text-ink underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
