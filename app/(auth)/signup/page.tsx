"use client";

import { TopoBackground } from "@/components/ui/TopoBackground";
import { createClient } from "@/lib/supabase/client";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const markets = [
  "GB Power",
  "NBP",
  "TTF",
  "Carbon",
  "Continental European Power",
] as const;

const roles = [
  "Trader",
  "Risk Manager",
  "Analyst",
  "Portfolio Manager",
] as const;

const steps = ["Account", "Markets", "Role", "Legal"] as const;

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [tos, setTos] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const passwordChecks = [
    { label: "At least 8 characters", ok: password.length >= 8 },
    { label: "One uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "One lowercase letter", ok: /[a-z]/.test(password) },
    { label: "One number", ok: /[0-9]/.test(password) },
    { label: "One special character", ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const passwordStrong = passwordChecks.every((c) => c.ok);
  const canContinueFromAccount =
    fullName.trim().length > 0 && email.trim().length > 0 && passwordStrong;

  useEffect(() => {
    let mounted = true;
    async function loadSession() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!mounted) return;
        setSessionEmail(user?.email ?? null);
      } finally {
        if (mounted) setCheckingSession(false);
      }
    }
    loadSession();
    return () => {
      mounted = false;
    };
  }, []);

  function toggleMarket(m: string) {
    setSelectedMarkets((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  }

  function next() {
    setError(null);
    setInfo(null);
    if (step === 0 && !canContinueFromAccount) {
      setError(
        "Complete account details and meet all password requirements before continuing.",
      );
      return;
    }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function back() {
    setError(null);
    setInfo(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleCreateAccount() {
    setError(null);
    setInfo(null);

    if (!tos || !privacy) {
      return;
    }

    if (!fullName.trim() || !email.trim() || !password) {
      setError("Please complete your account details.");
      return;
    }
    const policy = validatePasswordPolicy(password);
    if (!policy.ok) {
      setError(`Password policy: ${policy.reasons.join(" ")}`);
      return;
    }

    if (selectedMarkets.length === 0) {
      setError("Select at least one market.");
      return;
    }

    if (!role) {
      setError("Select a role.");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
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

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
          data: {
            full_name: fullName.trim(),
            markets: selectedMarkets,
            role,
          },
        },
      });

      if (signUpError) {
        setError("Could not create account. Please check your details and try again.");
        return;
      }

      if (data.session) {
        router.push("/dashboard/overview");
        router.refresh();
        return;
      }

      setInfo(
        "Check your email to confirm your account before signing in.",
      );
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-ivory px-4 py-12 sm:py-16">
      <TopoBackground className="absolute inset-0 h-full w-full" lineOpacity={0.15} />
      <div className="mx-auto w-full max-w-[520px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-8 sm:px-8 sm:py-10"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
                Step {step + 1} of {steps.length}
              </p>
              <h1 className="mt-2 font-serif text-2xl text-ink sm:text-3xl">
                Join Zephyr
              </h1>
            </div>
            <Link
              href="/login"
              className="text-xs font-medium uppercase tracking-[0.1em] text-ink-mid hover:text-ink"
            >
              Log in
            </Link>
          </div>

          {checkingSession ? null : sessionEmail ? (
            <div className="mt-8 rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                Already signed in
              </p>
              <p className="mt-2 text-sm text-ink">
                You are currently signed in as {sessionEmail}.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard/overview"
                  className="rounded-[4px] bg-ink px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-ivory transition-colors hover:bg-[#1f1d1a]"
                >
                  Continue to dashboard
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    const supabase = createClient();
                    await supabase.auth.signOut();
                    setSessionEmail(null);
                  }}
                  className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark"
                >
                  Sign out to create another account
                </button>
              </div>
            </div>
          ) : (
            <>
              <ol className="mt-8 flex gap-2" aria-label="Progress">
                {steps.map((label, i) => (
                  <li key={label} className="flex-1">
                    <div
                      className={`h-1 rounded-full ${
                        i <= step ? "bg-ink" : "bg-ivory-border"
                      }`}
                    />
                    <span className="mt-2 block text-[9px] font-medium uppercase tracking-[0.08em] text-ink-light">
                      {label}
                    </span>
                  </li>
                ))}
              </ol>

              <AnimatePresence mode="wait">
                {step === 0 && (
                  <motion.div
                    key="s1"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.22 }}
                    className="mt-10 space-y-4"
                  >
                    <Field
                      label="Full name"
                      id="name"
                      name="name"
                      value={fullName}
                      onChange={(v) => setFullName(v)}
                    />
                    <Field
                      label="Work email"
                      id="email"
                      name="email"
                      type="email"
                      value={email}
                      onChange={(v) => setEmail(v)}
                    />
                    <Field
                      label="Password"
                      id="password"
                      name="password"
                      type="password"
                      value={password}
                      onChange={(v) => setPassword(v)}
                    />
                    <div className="space-y-1.5 pt-1">
                      {passwordChecks.map((check) => (
                        <div
                          key={check.label}
                          className="flex items-center gap-2 text-xs text-ink-mid"
                        >
                          <span
                            aria-hidden="true"
                            className={`inline-flex h-4 w-4 items-center justify-center rounded-full border-[0.5px] text-[10px] transition-colors ${
                              check.ok
                                ? "border-[#1D6B4E]/50 bg-[#1D6B4E]/10 text-[#1D6B4E]"
                                : "border-ivory-border bg-ivory text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                          <span>{check.label}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {step === 1 && (
                  <motion.div
                    key="s2"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.22 }}
                    className="mt-10"
                  >
                    <p className="text-sm text-ink-mid">
                      Select the markets you trade or cover.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {markets.map((m) => {
                        const on = selectedMarkets.includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => toggleMarket(m)}
                            className={`rounded-[4px] border-[0.5px] px-3 py-2 text-left text-xs font-medium transition-colors duration-200 ${
                              on
                                ? "border-ink bg-ivory-dark text-ink"
                                : "border-ivory-border bg-ivory text-ink-mid hover:border-ink/30"
                            }`}
                          >
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}

                {step === 2 && (
                  <motion.div
                    key="s3"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.22 }}
                    className="mt-10"
                  >
                    <p className="text-sm text-ink-mid">
                      How do you work with risk?
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {roles.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRole(r)}
                          className={`rounded-[4px] border-[0.5px] px-3 py-3 text-left text-sm font-medium transition-colors duration-200 ${
                            role === r
                              ? "border-ink bg-ivory-dark text-ink"
                              : "border-ivory-border bg-ivory text-ink-mid hover:border-ink/30"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {step === 3 && (
                  <motion.div
                    key="s4"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.22 }}
                    className="mt-10 space-y-4"
                  >
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-mid">
                      <input
                        type="checkbox"
                        checked={tos}
                        onChange={(e) => setTos(e.target.checked)}
                        className="mt-1 size-4 rounded border-[0.5px] border-ivory-border bg-ivory text-ink"
                      />
                      <span>
                        I agree to the{" "}
                        <Link
                          href="/terms"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink underline-offset-4 hover:underline"
                        >
                          Terms of Service
                        </Link>
                        .
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-mid">
                      <input
                        type="checkbox"
                        checked={privacy}
                        onChange={(e) => setPrivacy(e.target.checked)}
                        className="mt-1 size-4 rounded border-[0.5px] border-ivory-border bg-ivory text-ink"
                      />
                      <span>
                        I acknowledge the{" "}
                        <Link
                          href="/privacy"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink underline-offset-4 hover:underline"
                        >
                          Privacy Policy
                        </Link>
                        .
                      </span>
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-10 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={back}
                  disabled={step === 0}
                  className={`text-xs font-semibold uppercase tracking-[0.12em] ${
                    step === 0
                      ? "text-ink-light"
                      : "text-ink-mid hover:text-ink"
                  }`}
                >
                  Back
                </button>
                {step < steps.length - 1 ? (
                  <button
                    type="button"
                    onClick={next}
                    disabled={step === 0 && !canContinueFromAccount}
                    className="rounded-[4px] bg-ink px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-ivory transition-colors duration-200 enabled:hover:bg-[#1f1d1a] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCreateAccount}
                    disabled={!tos || !privacy || loading}
                    className="rounded-[4px] bg-ink px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-ivory transition-colors duration-200 enabled:hover:bg-[#1f1d1a] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loading ? "Creating…" : "Create account"}
                  </button>
                )}
              </div>
            </>
          )}

          {error ? (
            <p className="mt-6 text-sm text-bear" role="alert">
              {error}
            </p>
          ) : null}
          {info ? (
            <p className="mt-6 text-sm text-ink-mid" role="status">
              {info}
            </p>
          ) : null}
          {info ? (
            <p className="mt-2 text-sm text-ink-mid">
              Didn&apos;t get it?{" "}
              <Link href="/verify-email" className="underline-offset-4 hover:underline">
                Resend verification email
              </Link>
              .
            </p>
          ) : null}
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  name,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  id: string;
  name: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-light focus:border-ink/40"
      />
    </div>
  );
}
