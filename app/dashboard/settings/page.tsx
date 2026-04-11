"use client";

import { createClient } from "@/lib/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

const tabs = [
  "Profile",
  "Markets",
  "Notifications",
  "Billing",
  "API",
] as const;

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
        ) : (
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-8"
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              {tab}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProfilePanel() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        <form className="mt-6 space-y-5" onSubmit={handleSave}>
          <div>
            <label
              htmlFor="fullName"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
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
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
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
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
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
        </form>
      )}
    </motion.div>
  );
}
