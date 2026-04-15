"use client";

import { createClient } from "@/lib/supabase/client";
import { TIER_ENTITLEMENTS } from "@/lib/billing/entitlements";
import { defaultTeamNameFromUser } from "@/lib/team/default-team-name";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

const baseTabs = ["Profile", "Markets & Alerts", "Plan & API"] as const;
const teamTab = "Team" as const;

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<string>("Profile");
  const [showTeamTab, setShowTeamTab] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/billing/status")
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { effectiveTier?: string };
        const t = body.effectiveTier;
        if (!cancelled && (t === "team" || t === "enterprise")) {
          setShowTeamTab(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const urlWantsTeam =
    showTeamTab && searchParams.get("tab")?.toLowerCase() === "team";
  const activeTab = urlWantsTeam ? "Team" : tab;

  function selectTab(next: string) {
    setTab(next);
    if (searchParams.has("tab")) {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("tab");
      const q = sp.toString();
      router.replace(q ? `/dashboard/settings?${q}` : "/dashboard/settings");
    }
  }

  const visibleTabs = showTeamTab
    ? ([...baseTabs, teamTab] as const)
    : baseTabs;

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
          {visibleTabs.map((t) => {
            const on = activeTab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => selectTab(t)}
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
        {activeTab === "Profile" ? (
          <ProfilePanel key="profile" />
        ) : activeTab === "Markets & Alerts" ? (
          <MarketsAlertsPanel key="markets" />
        ) : activeTab === "Plan & API" ? (
          <PlanApiPanel key="plan" />
        ) : activeTab === "Team" ? (
          <TeamPanel key="team" />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-8 py-12 text-center text-sm text-ink-mid">
          Loading settings…
        </div>
      }
    >
      <SettingsPageInner />
    </Suspense>
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
  const [deletePassword, setDeletePassword] = useState("");
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
    setError(null);
    try {
      const supabase = createClient();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        throw signOutError;
      }
      // Use hard navigation so middleware sees fresh cookies state.
      window.location.assign("/login");
    } catch {
      setError("Could not sign out. Please try again.");
      setSigningOut(false);
    }
  }

  async function handleDeleteAccount() {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const resp = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      if (!resp.ok) {
        const body: { code?: string; error?: string } = await resp
          .json()
          .catch(() => ({}));
        if (body.code === "UNAUTHORIZED") {
          throw new Error("Your session has expired. Please sign in again.");
        }
        if (body.code === "PASSWORD_REQUIRED") {
          throw new Error("Please enter your password to confirm account deletion.");
        }
        if (body.code === "PASSWORD_INVALID") {
          throw new Error("Password is incorrect. Please try again.");
        }
        if (body.code === "SERVER_MISCONFIGURED") {
          throw new Error("Account deletion is temporarily unavailable.");
        }
        if (
          body.code === "DATA_CLEANUP_FAILED" ||
          body.code === "AUTH_DELETE_FAILED" ||
          body.code === "INTERNAL_ERROR"
        ) {
          throw new Error("Could not delete account. Contact contact@zephyr.markets.");
        }
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
      setDeletePassword("");
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
                <div className="mt-3 max-w-md">
                  <label
                    htmlFor="delete-password"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8B3A3A]"
                  >
                    Confirm password
                  </label>
                  <input
                    id="delete-password"
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full rounded-[4px] border-[0.5px] border-[#8B3A3A]/30 bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-[#8B3A3A]/60"
                    placeholder="Enter your password"
                  />
                </div>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={deleting || !deletePassword.trim()}
                    className="rounded-[4px] bg-[#8B3A3A] px-4 py-2 text-xs font-semibold tracking-[0.08em] text-ivory transition-colors hover:bg-[#7a2f2f] disabled:opacity-60"
                  >
                    {deleting ? "Deleting..." : "Yes, delete my account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirm(false);
                      setDeletePassword("");
                    }}
                    className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 py-2 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {error ? (
              <p className="mt-3 text-sm text-bear" role="alert">
                {error}
              </p>
            ) : null}
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

type TeamMemberRow = {
  id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  display_name?: string;
};

type InvitationRow = {
  id: string;
  invited_email: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  token?: string;
};

function TeamPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [suggestedTeamName, setSuggestedTeamName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [nameEdit, setNameEdit] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [data, setData] = useState<{
    team: { id: string; name: string; owner_id?: string; created_at?: string } | null;
    members: TeamMemberRow[];
    invitations: Array<InvitationRow & { token?: string }>;
    seatLimit: number | "unlimited";
    usedSeats: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/team/members");
      const body = (await res.json()) as {
        error?: string;
        team?: { id: string; name: string } | null;
        members?: TeamMemberRow[];
        invitations?: Array<InvitationRow & { token?: string }>;
        seatLimit?: number | "unlimited";
        usedSeats?: number;
      };
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to load team");
      }
      setData({
        team: body.team ?? null,
        members: body.members ?? [],
        invitations: body.invitations ?? [],
        seatLimit: body.seatLimit ?? 5,
        usedSeats: body.usedSeats ?? 0,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load team");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const sb = createClient();
    void sb.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      const suggested = defaultTeamNameFromUser(data.user);
      setSuggestedTeamName(suggested);
      setTeamName((prev) => (prev === "" ? suggested : prev));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (data?.team?.name) setNameEdit(data.team.name);
  }, [data?.team?.name]);

  async function saveTeamName() {
    if (!data?.team) return;
    const next = nameEdit.trim();
    if (!next || next === data.team.name) return;
    setSavingName(true);
    setError(null);
    setCopyMsg(null);
    try {
      const res = await fetch("/api/team/name", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not update team name");
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not update team name");
    } finally {
      setSavingName(false);
    }
  }

  async function createTeam() {
    setCreating(true);
    setError(null);
    setCopyMsg(null);
    try {
      const res = await fetch("/api/team/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: teamName.trim() }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not create team");
      }
      await load();
      setTeamName("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create team");
    } finally {
      setCreating(false);
    }
  }

  async function invite() {
    setInviting(true);
    setError(null);
    setCopyMsg(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        invitation?: { token?: string };
      };
      if (!res.ok) {
        if (res.status === 409 && body.code === "SEAT_LIMIT_REACHED") {
          throw new Error(body.error ?? "Seat limit reached for this plan.");
        }
        throw new Error(body.error ?? "Could not send invite");
      }
      setInviteEmail("");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not send invite");
    } finally {
      setInviting(false);
    }
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/dashboard/team/join?token=${encodeURIComponent(token)}`;
    void navigator.clipboard.writeText(url);
    setCopyMsg("Invite link copied to clipboard.");
    setTimeout(() => setCopyMsg(null), 4000);
  }

  const seatLimit = data?.seatLimit ?? "—";
  const usedSeats = data?.usedSeats ?? "—";

  return (
    <motion.div
      key="team"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          Team workspace
        </p>
        <p className="mt-2 text-sm text-ink-mid">
          Create a team, invite colleagues by email, and share seats. Invitees
          open the link below (or paste it after signing in with the invited
          address).
        </p>
        {loading ? (
          <p className="mt-3 text-xs text-ink-light">Loading team…</p>
        ) : null}
        {error ? <p className="mt-3 text-xs text-bear">{error}</p> : null}
        {copyMsg ? <p className="mt-2 text-xs text-bull">{copyMsg}</p> : null}
      </div>

      {!data?.team ? (
        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Create team
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block min-w-[200px] flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-light">
                Name
              </span>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder={
                  suggestedTeamName || "e.g. Dean's team"
                }
                className="mt-1 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2 text-sm text-ink"
              />
            </label>
            <button
              type="button"
              disabled={creating}
              onClick={() => void createTeam()}
              className="inline-flex h-9 items-center justify-center rounded-[4px] bg-gold px-4 text-xs font-semibold tracking-[0.08em] text-ivory transition-colors hover:bg-[#7a5f1a] disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create team"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Team name
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block min-w-[200px] flex-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-light">
                  Name
                </span>
                <input
                  type="text"
                  value={nameEdit}
                  onChange={(e) => setNameEdit(e.target.value)}
                  className="mt-1 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2 text-sm text-ink"
                />
              </label>
              <button
                type="button"
                disabled={
                  savingName ||
                  !nameEdit.trim() ||
                  nameEdit.trim() === data.team.name
                }
                onClick={() => void saveTeamName()}
                className="inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
              >
                {savingName ? "Saving…" : "Save name"}
              </button>
            </div>
            <p className="mt-3 font-mono text-[11px] text-ink-light">
              Seats: {String(usedSeats)} / {String(seatLimit)}
            </p>
          </div>

          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Invite member
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block min-w-[220px] flex-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-light">
                  Email
                </span>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="mt-1 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2 text-sm text-ink"
                />
              </label>
              <button
                type="button"
                disabled={inviting || !inviteEmail.trim()}
                onClick={() => void invite()}
                className="inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
              >
                {inviting ? "Sending…" : "Send invite"}
              </button>
            </div>
          </div>

          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Pending invitations
            </p>
            {data.invitations.length === 0 ? (
              <p className="mt-3 text-sm text-ink-mid">No pending invites.</p>
            ) : (
              <ul className="mt-4 divide-y-[0.5px] divide-ivory-border">
                {data.invitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm text-ink">{inv.invited_email}</p>
                      <p className="text-[10px] text-ink-light">
                        {inv.status} ·{" "}
                        {inv.expires_at
                          ? `expires ${new Date(inv.expires_at).toLocaleString("en-GB")}`
                          : "no expiry"}
                      </p>
                    </div>
                    {inv.token ? (
                      <button
                        type="button"
                        onClick={() => copyInviteLink(inv.token!)}
                        className="shrink-0 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-mid transition-colors hover:bg-ivory-dark hover:text-ink"
                      >
                        Copy invite link
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Members
            </p>
            {data.members.length === 0 ? (
              <p className="mt-3 text-sm text-ink-mid">No members yet.</p>
            ) : (
              <ul className="mt-4 divide-y-[0.5px] divide-ivory-border">
                {data.members.map((m) => (
                  <li key={m.id} className="py-3 text-sm text-ink">
                    <span className="text-ink">
                      {m.display_name ?? `${m.user_id.slice(0, 8)}…`}
                    </span>
                    <span className="ml-2 text-ink-light">
                      {m.role} · {m.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}

function PlanApiPanel() {
  const pro = TIER_ENTITLEMENTS.pro;
  const team = TIER_ENTITLEMENTS.team;
  const [billingStatus, setBillingStatus] = useState<{
    effectiveTier: "free" | "pro" | "team" | "enterprise";
    status: string;
    statusLabel: string;
    interval: "monthly" | "annual" | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    accessState: "paid" | "grace" | "free";
    actionRequired: "none" | "payment_method" | "new_subscription";
    canUsePremiumNow: boolean;
  } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [startingCheckout, setStartingCheckout] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadBillingStatus() {
      setLoadingStatus(true);
      setStatusError(null);
      try {
        const res = await fetch("/api/billing/status", { method: "GET" });
        if (!res.ok) {
          const body: { error?: string } = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load billing status");
        }
        const body = (await res.json()) as {
          effectiveTier: "free" | "pro" | "team" | "enterprise";
          status: string;
          statusLabel: string;
          interval: "monthly" | "annual" | null;
          currentPeriodEnd: string | null;
          cancelAtPeriodEnd: boolean;
          accessState: "paid" | "grace" | "free";
          actionRequired: "none" | "payment_method" | "new_subscription";
          canUsePremiumNow: boolean;
        };
        if (!cancelled) setBillingStatus(body);
      } catch (err: unknown) {
        if (!cancelled) {
          setStatusError(
            err instanceof Error ? err.message : "Could not load billing status.",
          );
        }
      } finally {
        if (!cancelled) setLoadingStatus(false);
      }
    }
    loadBillingStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentTierCode = billingStatus?.effectiveTier ?? "free";
  const currentTier = TIER_ENTITLEMENTS[currentTierCode];
  const statusLabel = billingStatus?.statusLabel ?? "active";
  const periodEndLabel =
    billingStatus?.currentPeriodEnd != null
      ? new Date(billingStatus.currentPeriodEnd).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : null;
  const showBillingIssueBanner =
    billingStatus?.status === "past_due" ||
    billingStatus?.status === "unpaid" ||
    billingStatus?.status === "incomplete" ||
    billingStatus?.status === "incomplete_expired";
  const billingIssueMessage =
    billingStatus?.status === "past_due"
      ? `Payment is overdue. Premium access remains available until ${periodEndLabel ?? "the current period end"}.`
      : billingStatus?.status === "unpaid" ||
          billingStatus?.status === "incomplete" ||
          billingStatus?.status === "incomplete_expired"
        ? "Payment action is required. Premium features are currently restricted until billing is resolved."
        : null;

  async function startCheckout(tier: "pro" | "team", interval: "monthly" | "annual") {
    setStartingCheckout(`${tier}-${interval}`);
    setStatusError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier, interval }),
      });
      const body: { url?: string; error?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? "Could not start checkout.");
      }
      window.location.assign(body.url);
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : "Could not start checkout.");
      setStartingCheckout(null);
    }
  }

  async function openPortal() {
    setOpeningPortal(true);
    setStatusError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body: { url?: string; error?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? "Could not open billing portal.");
      }
      window.location.assign(body.url);
    } catch (err: unknown) {
      setStatusError(
        err instanceof Error ? err.message : "Could not open billing portal.",
      );
      setOpeningPortal(false);
    }
  }

  const endpoints = [
    {
      method: "GET",
      path: "/api/v1/premium",
      desc: "Latest physical premium score",
      status: "live",
    },
    {
      method: "GET",
      path: "/api/v1/signals",
      desc: "REMIT signal feed",
      status: "planned",
    },
    {
      method: "GET",
      path: "/api/v1/markets",
      desc: "Market prices — N2EX, TTF, NBP",
      status: "planned",
    },
    {
      method: "GET",
      path: "/api/v1/storage",
      desc: "EU gas storage levels",
      status: "planned",
    },
    {
      method: "GET",
      path: "/api/v1/weather",
      desc: "GB wind and solar forecast",
      status: "planned",
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
            <p className="font-serif text-2xl text-ink">{currentTier.label}</p>
            {billingStatus?.interval ? (
              <p className="mt-1 text-xs text-ink-light">
                Billing interval:{" "}
                {billingStatus.interval === "annual" ? "Annual" : "Monthly"}
              </p>
            ) : null}
            {periodEndLabel ? (
              <p className="mt-1 text-xs text-ink-light">
                Current period end: {periodEndLabel}
              </p>
            ) : null}
            {billingStatus?.cancelAtPeriodEnd ? (
              <p className="mt-1 text-xs text-bear">
                Subscription will cancel at period end.
              </p>
            ) : null}
          </div>
          <span className="rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
            {loadingStatus ? "Loading" : statusLabel}
          </span>
        </div>
        {loadingStatus ? (
          <p className="mt-3 text-xs text-ink-light">Loading billing status...</p>
        ) : null}
        {showBillingIssueBanner && billingIssueMessage ? (
          <div className="mt-4 rounded-[4px] border-[0.5px] border-bear/30 bg-bear/5 px-3 py-2">
            <p className="text-xs text-bear">{billingIssueMessage}</p>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-ink-light">
          Plan changes and payment methods are completed in Stripe&apos;s secure
          billing portal. You&apos;ll return to Zephyr on the Overview page when
          finished.
        </p>
        {currentTierCode !== "free" ? (
          <button
            type="button"
            disabled={openingPortal}
            onClick={openPortal}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
          >
            {openingPortal ? "Opening portal..." : "Manage in billing portal"}
          </button>
        ) : null}
        {billingStatus?.actionRequired === "payment_method" &&
        currentTierCode === "free" ? (
          <button
            type="button"
            disabled={openingPortal}
            onClick={openPortal}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
          >
            {openingPortal ? "Opening portal..." : "Update payment method"}
          </button>
        ) : null}
      </div>

      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          Upgrade
        </p>
        <p className="mt-2 text-xs text-ink-light">
          Checkout opens on Stripe. After a successful payment you&apos;ll land on
          Overview with a confirmation banner.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[4px] border-[0.5px] border-gold/45 bg-ivory p-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Pro
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">
              £{pro.monthlyPriceGbp}
              <span className="ml-1 font-sans text-sm font-medium text-ink-mid">
                /month
              </span>
            </p>
            <p className="mt-2 text-sm text-ink-mid">
              Live signals, {pro.morningBriefTimeGmt} brief, five markets, portfolio
              tools.
            </p>
            <button
              type="button"
              onClick={() => startCheckout("pro", "monthly")}
              disabled={startingCheckout != null}
              className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-[4px] bg-gold text-xs font-semibold tracking-[0.08em] text-ivory transition-colors hover:bg-[#7a5f1a] disabled:opacity-60"
            >
              {startingCheckout === "pro-monthly" ? "Redirecting..." : "Get Pro"}
            </button>
            <button
              type="button"
              onClick={() => startCheckout("pro", "annual")}
              disabled={startingCheckout != null}
              className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-[4px] border-[0.5px] border-gold/45 bg-ivory text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
            >
              {startingCheckout === "pro-annual"
                ? "Redirecting..."
                : "Get Pro Annual (£390/year)"}
            </button>
          </div>
          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory p-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Team
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">
              £{team.monthlyPriceGbp}
              <span className="ml-1 font-sans text-sm font-medium text-ink-mid">
                /month
              </span>
            </p>
            <p className="mt-2 text-sm text-ink-mid">
              Five seats, unlimited positions, API access, all markets.
            </p>
            <button
              type="button"
              onClick={() => startCheckout("team", "monthly")}
              disabled={startingCheckout != null}
              className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
            >
              {startingCheckout === "team-monthly" ? "Redirecting..." : "Get Team"}
            </button>
          </div>
        </div>
        {statusError ? <p className="mt-4 text-xs text-bear">{statusError}</p> : null}
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
              <span className="ml-auto text-xs text-ink-light">
                {e.desc} {e.status === "live" ? "· Live" : "· Planned"}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-light">
          {currentTierCode === "team" || currentTierCode === "enterprise"
            ? "Team API access is enabled. /api/v1/premium is live; additional endpoints are being rolled out."
            : "API access is unlocked on Team plan and above."}
        </p>
      </div>
    </motion.div>
  );
}
