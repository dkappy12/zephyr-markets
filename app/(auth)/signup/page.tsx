"use client";

import { createClient } from "@/lib/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const markets = [
  "GB Power",
  "NBP",
  "TTF",
  "LNG",
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

  function toggleMarket(m: string) {
    setSelectedMarkets((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  }

  function next() {
    setError(null);
    setInfo(null);
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
        setError(signUpError.message);
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
    <div className="min-h-screen bg-ivory px-4 py-12 sm:py-16">
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
                    <span className="text-ink">Terms of Service</span>.
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
                    <span className="text-ink">Privacy Policy</span>.
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
                className="rounded-[4px] bg-ink px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-ivory transition-colors duration-200 hover:bg-[#1f1d1a]"
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
