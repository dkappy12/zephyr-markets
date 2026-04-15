"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { motion } from "framer-motion";

function TeamJoinInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token")?.trim() ?? "";
  const [phase, setPhase] = useState<"ready" | "loading" | "success" | "error">(
    "ready",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPhase("error");
      setMessage(
        "This link is missing the invitation token. Ask your team owner to send a new invite from Settings → Team.",
      );
    }
  }, [token]);

  async function accept() {
    if (!token) return;
    setPhase("loading");
    setMessage(null);
    setCode(null);
    try {
      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        setCode(typeof body.code === "string" ? body.code : null);
        throw new Error(body.error ?? "Could not accept invitation");
      }
      setPhase("success");
      setMessage("You have joined the team.");
      router.replace("/dashboard/settings?tab=team");
    } catch (e: unknown) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "Could not accept invitation");
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-8"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-mid">
          Team invitation
        </p>
        <h1 className="mt-3 font-serif text-2xl text-ink">Join your team</h1>
        <p className="mt-2 text-sm text-ink-mid">
          Sign in with the email address that was invited, then accept below.
        </p>
        {message ? (
          <p
            className={`mt-4 text-sm ${
              phase === "success" ? "text-bull" : "text-bear"
            }`}
          >
            {message}
          </p>
        ) : null}
        {code === "INVITE_EMAIL_MISMATCH" ? (
          <p className="mt-2 text-xs text-ink-light">
            You are signed in as a different email than the one invited. Sign out
            and sign in with the invited address, or ask for a new invite.
          </p>
        ) : null}
        {phase === "success" ? (
          <Link
            href="/dashboard/settings"
            className="mt-6 inline-flex h-10 items-center rounded-[4px] bg-gold px-4 text-xs font-semibold tracking-[0.08em] text-ivory transition-colors hover:bg-[#7a5f1a]"
          >
            Open settings
          </Link>
        ) : token ? (
          <button
            type="button"
            disabled={phase === "loading"}
            onClick={() => void accept()}
            className="mt-6 inline-flex h-10 items-center rounded-[4px] bg-gold px-4 text-xs font-semibold tracking-[0.08em] text-ivory transition-colors hover:bg-[#7a5f1a] disabled:opacity-60"
          >
            {phase === "loading" ? "Accepting…" : "Accept invitation"}
          </button>
        ) : (
          <Link
            href="/login"
            className="mt-6 inline-flex h-10 items-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark"
          >
            Sign in
          </Link>
        )}
      </motion.div>
    </div>
  );
}

export default function TeamJoinPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-sm text-ink-mid">
          Loading invitation…
        </div>
      }
    >
      <TeamJoinInner />
    </Suspense>
  );
}
