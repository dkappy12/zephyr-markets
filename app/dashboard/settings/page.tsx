"use client";

import { createClient } from "@/lib/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const tabs = ["Profile", "Markets & Alerts", "Plan & API"] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Profile");

  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Settings
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Account, markets, alerts, billing, and API access.
        </p>
      </div>

      <div className="border-b-[0.5px] border-ivory-border">
        <nav
          className="-mb-[0.5px] flex flex-wrap gap-1"
          aria-label="Settings tabs"
        >
          {tabs.map((t) => {
            const on = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-t-[4px] border-[0.5px] border-b-0 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors duration-200 ${
                  on
                    ? "border-ivory-border bg-card text-ink"
                    : "border-transparent text-ink-mid hover:text-ink"
                }`}
              >
                {t}
              </button>
            );
          })}
        </nav>
      </div>

      <AnimatePresence mode="wait">
        {tab === "Profile" ? (
          <ProfilePanel key="profile" />
        ) : tab === "Markets & Alerts" ? (
          <MarketsAlertsPanel key="markets" />
        ) : tab === "Plan & API" ? (
          <PlanApiPanel key="plan" />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ProfilePanel() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const user = data.user;
      if (user) {
        setEmail(user.email ?? "");
        setFullName(
          (user.user_metadata?.full_name as string | undefined) ?? "",
        );
        setRole((user.user_metadata?.role as string | undefined) ?? "");
      }
    } catch {
      setError("Could not load profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const supabase = createClient();
      const { error: upErr } = await supabase.auth.updateUser({
        data: { full_name: fullName.trim() },
      });
      if (upErr) throw upErr;
      setMessage("Saved.");
    } catch {
      setError("Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function handleDeleteAccount() {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const resp = await fetch("/api/account/delete", { method: "DELETE" });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete account");
      }
      // Sign out client-side and redirect
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not delete account. Contact contact@zephyr.markets.",
      );
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-8"
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
        Profile
      </p>
      {loading ? (
        <p className="mt-4 text-sm text-ink-mid">Loading…</p>
      ) : (
        <form className="mt-6 space-y-7" onSubmit={handleSave}>
          <div>
            <label
              htmlFor="fullName"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
            >
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-2 w-full max-w-md rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
            />
          </div>
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              disabled
              className="mt-2 w-full max-w-md cursor-not-allowed rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-3 py-2.5 text-sm text-ink-mid"
            />
          </div>
          <div>
            <label
              htmlFor="role"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
            >
              Role
            </label>
            <input
              id="role"
              type="text"
              value={role}
              disabled
              className="mt-2 w-full max-w-md cursor-not-allowed rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-3 py-2.5 text-sm text-ink-mid"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-[4px] bg-ink px-5 py-2.5 text-xs font-semibold tracking-[0.08em] text-ivory transition-colors duration-200 hover:bg-[#1f1d1a] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {message ? (
            <p className="text-sm text-ink-mid" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-bear" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-8 border-t-[0.5px] border-ivory-border pt-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Appearance
            </p>
            <div className="mt-4 flex max-w-md items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Dark mode</p>
                <p className="mt-0.5 text-xs text-ink-light">
                  Coming soon — toggle will be enabled in a future update.
                </p>
              </div>
              <button
                type="button"
                disabled
                onClick={() => setDarkMode((v) => !v)}
                className="relative inline-flex h-6 w-11 cursor-not-allowed items-center rounded-full border-[0.5px] border-ivory-border bg-ivory-dark opacity-50 transition-colors"
                aria-label="Dark mode toggle (coming soon)"
                aria-pressed={darkMode}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-ink-light transition-transform ${
                    darkMode ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="mt-8 border-t-[0.5px] border-ivory-border pt-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Account
            </p>
            <div className="mt-4 flex items-center gap-4">
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 py-2 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
              >
                {signingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>

          <div className="mt-8 border-t-[0.5px] border-[#8B3A3A]/20 pt-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#8B3A3A]">
              Danger zone
            </p>
            {!deleteConfirm ? (
              <div className="mt-4">
                <p className="text-sm text-ink-mid">
                  Permanently delete your account and all associated data. This
                  cannot be undone.
                </p>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  className="mt-3 rounded-[4px] border-[0.5px] border-[#8B3A3A]/40 bg-ivory px-4 py-2 text-xs font-semibold tracking-[0.08em] text-[#8B3A3A] transition-colors hover:bg-[#8B3A3A]/5"
                >
                  Delete account
                </button>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-sm font-medium text-[#8B3A3A]">
                  Are you sure? This will permanently delete your account and
                  all data.
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={deleting}
                    className="rounded-[4px] bg-[#8B3A3A] px-4 py-2 text-xs font-semibold tracking-[0.08em] text-ivory transition-colors hover:bg-[#7a2f2f] disabled:opacity-60"
                  >
                    {deleting ? "Deleting..." : "Yes, delete my account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(false)}
                    className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 py-2 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      )}
    </motion.div>
  );
}

function MarketsAlertsPanel() {
  const markets = [
    {
      name: "GB Power",
      detail: "N2EX Day-Ahead · Elexon BMRS MID",
      status: "Live",
    },
    {
      name: "TTF Natural Gas",
      detail: "EEX NGP · 15-min updates",
      status: "Live",
    },
    {
      name: "NBP Natural Gas",
      detail: "ICE NF.F via Stooq · 15-min updates",
      status: "Live",
    },
    {
      name: "EU Gas Storage",
      detail: "GIE AGSI · DE, FR, IT, NL, AT",
      status: "Live",
    },
    {
      name: "GB Solar",
      detail: "Sheffield Solar PV_Live · 5-min updates",
      status: "Live",
    },
    {
      name: "GB Wind",
      detail: "Elexon BMRS FUELINST · 5-min actuals",
      status: "Live",
    },
    {
      name: "Carbon (UKA + CPS)",
      detail: "UKA configurable via env · CPS £18/t fixed",
      status: "Live",
    },
    {
      name: "FX Rate (EUR/GBP)",
      detail: "Frankfurter API · daily fix",
      status: "Live",
    },
  ];

  const alerts = [
    { label: "Physical premium score", value: "Alert when |score| ≥ 4.0" },
    { label: "REMIT severity", value: "HIGH notices only" },
    { label: "Wind drought threshold", value: "GB wind < 5 GW for 3+ hours" },
  ];

  return (
    <motion.div
      key="markets"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          Active data feeds
        </p>
        <p className="mt-1 text-xs text-ink-light">
          All feeds update automatically. No configuration required.
        </p>
        <div className="mt-5 divide-y-[0.5px] divide-ivory-border">
          {markets.map((m) => (
            <div key={m.name} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-ink">{m.name}</p>
                <p className="mt-0.5 text-xs text-ink-light">{m.detail}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-[3px] border-[0.5px] border-[#1D6B4E]/30 bg-[#1D6B4E]/8 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#1D6B4E]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#1D6B4E]" />
                {m.status}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-light">
          Additional markets and custom feed configuration coming soon.
        </p>
      </div>

      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          Alert thresholds
        </p>
        <p className="mt-1 text-xs text-ink-light">
          Current default thresholds. Configurable alert preferences coming
          soon.
        </p>
        <div className="mt-5 divide-y-[0.5px] divide-ivory-border">
          {alerts.map((a) => (
            <div key={a.label} className="flex items-center justify-between py-3">
              <p className="text-sm text-ink">{a.label}</p>
              <span className="rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-2.5 py-1 font-mono text-[10px] text-ink-mid">
                {a.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function PlanApiPanel() {
  const endpoints = [
    { method: "GET", path: "/api/v1/premium", desc: "Latest physical premium score" },
    { method: "GET", path: "/api/v1/signals", desc: "REMIT signal feed" },
    {
      method: "GET",
      path: "/api/v1/markets",
      desc: "Market prices — N2EX, TTF, NBP",
    },
    { method: "GET", path: "/api/v1/storage", desc: "EU gas storage levels" },
    {
      method: "GET",
      path: "/api/v1/weather",
      desc: "GB wind and solar forecast",
    },
  ];

  return (
    <motion.div
      key="plan"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          Current plan
        </p>
        <div className="mt-4 flex items-start justify-between">
          <div>
            <p className="font-serif text-2xl text-ink">Free</p>
            <p className="mt-1 text-sm text-ink-mid">
              Physical premium score · Morning brief (06:00 GMT) · Signal feed ·
              GB Power and NBP
            </p>
          </div>
          <span className="rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
            Active
          </span>
        </div>
      </div>

      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          Upgrade
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[4px] border-[0.5px] border-gold/45 bg-ivory p-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Pro
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">
              £39
              <span className="ml-1 font-sans text-sm font-medium text-ink-mid">
                /month
              </span>
            </p>
            <p className="mt-2 text-sm text-ink-mid">
              Live signals, 06:00 brief, five markets, portfolio tools.
            </p>
            <a
              href="mailto:contact@zephyr.markets?subject=Pro%20plan%20upgrade"
              className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-[4px] bg-gold text-xs font-semibold tracking-[0.08em] text-ivory transition-colors hover:bg-[#7a5f1a]"
            >
              Get Pro
            </a>
          </div>
          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory p-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Team
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">
              £149
              <span className="ml-1 font-sans text-sm font-medium text-ink-mid">
                /month
              </span>
            </p>
            <p className="mt-2 text-sm text-ink-mid">
              Five seats, unlimited positions, API access, all markets.
            </p>
            <a
              href="mailto:contact@zephyr.markets?subject=Team%20plan%20upgrade"
              className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark"
            >
              Get Team
            </a>
          </div>
        </div>
        <p className="mt-4 text-xs text-ink-light">
          Stripe payment integration coming soon. Contact us to upgrade
          manually.
        </p>
      </div>

      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          API access
        </p>
        <p className="mt-1 text-xs text-ink-light">
          Full REST API available on the Team plan. Programmatic access to all
          Zephyr data feeds.
        </p>
        <div className="mt-5 divide-y-[0.5px] divide-ivory-border">
          {endpoints.map((e) => (
            <div key={e.path} className="flex items-center gap-4 py-3">
              <span className="w-10 shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-light">
                {e.method}
              </span>
              <span className="font-mono text-[11px] text-ink">{e.path}</span>
              <span className="ml-auto text-xs text-ink-light">{e.desc}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-light">
          API keys and full documentation available on Team plan. Coming soon.
        </p>
      </div>
    </motion.div>
  );
}
