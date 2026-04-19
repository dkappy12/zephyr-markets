"use client";

import { useTheme } from "@/context/ThemeContext";
import { createClient } from "@/lib/supabase/client";
import { TIER_ENTITLEMENTS } from "@/lib/billing/entitlements";
import { defaultTeamNameFromUser } from "@/lib/team/default-team-name";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const baseTabs = ["Profile", "Markets & Alerts", "Plan & API"] as const;
const teamTab = "Team" as const;

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<string>(() => {
    if (typeof window === "undefined") return "Profile";
    const p = new URLSearchParams(window.location.search).get("tab")?.toLowerCase();
    if (p === "plan" || p === "plan & api" || p === "plan%20%26%20api") return "Plan & API";
    if (p === "markets" || p === "markets & alerts") return "Markets & Alerts";
    if (p === "team") return "Team";
    return "Profile";
  });
  const [billingInfo, setBillingInfo] = useState<{
    effectiveTier?: string;
    status?: string;
  } | null>(null);
  const [billingFetched, setBillingFetched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/billing/status")
      .then(async (res) => {
        if (!cancelled) {
          if (!res.ok) {
            setBillingInfo(null);
          } else {
            const body = (await res.json()) as {
              effectiveTier?: string;
              status?: string;
            };
            setBillingInfo(body);
          }
          setBillingFetched(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBillingInfo(null);
          setBillingFetched(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showTeamTab = useMemo(() => {
    if (!billingFetched) return false;
    const t = billingInfo?.effectiveTier;
    const status = billingInfo?.status;
    return t === "team" && status !== "admin";
  }, [billingFetched, billingInfo]);

  useEffect(() => {
    if (
      !showTeamTab &&
      searchParams.get("tab")?.toLowerCase() === "team"
    ) {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("tab");
      const q = sp.toString();
      router.replace(q ? `/dashboard/settings?${q}` : "/dashboard/settings");
    }
  }, [showTeamTab, searchParams, router]);

  const urlWantsTeam =
    showTeamTab && searchParams.get("tab")?.toLowerCase() === "team";
  const activeTab =
    urlWantsTeam
      ? "Team"
      : !showTeamTab && tab === "Team"
        ? "Profile"
        : tab;

  function selectTab(next: string) {
    setTab(next);
    if (searchParams.has("tab")) {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("tab");
      const q = sp.toString();
      router.replace(q ? `/dashboard/settings?${q}` : "/dashboard/settings");
    }
  }

  const visibleTabs = [
    ...baseTabs,
    ...(showTeamTab ? [teamTab] : []),
  ];

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
        ) : showTeamTab && activeTab === "Team" ? (
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
  const { theme, setTheme, resetToSystem } = useTheme();
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
                  Follows your system preference by default.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className={`relative inline-flex h-6 w-11 items-center rounded-full border-[0.5px] transition-colors ${
                  theme === "dark"
                    ? "bg-ink border-ink"
                    : "bg-ivory-dark border-ivory-border"
                }`}
                aria-label="Toggle dark mode"
                aria-pressed={theme === "dark"}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full transition-transform ${
                    theme === "dark"
                      ? "translate-x-6 bg-ivory"
                      : "translate-x-1 bg-ink-light"
                  }`}
                />
              </button>
            </div>
            <button
              type="button"
              onClick={resetToSystem}
              className="mt-3 text-[10px] uppercase tracking-[0.1em] text-ink-light transition-colors hover:text-ink-mid"
            >
              Reset to system default
            </button>
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

const PREMIUM_ALERT_TYPE = "premium_score";
const N2EX_MOVE_ALERT_TYPE = "n2ex_daily_move";
const TTF_MOVE_ALERT_TYPE = "ttf_daily_move";
const NBP_MOVE_ALERT_TYPE = "nbp_daily_move";
const DEFAULT_PREMIUM_THRESHOLD = 3;
const DEFAULT_N2EX_MOVE = 5;
const DEFAULT_TTF_MOVE = 2;
const DEFAULT_NBP_MOVE = 2;

function clampPremiumScoreThreshold(n: number): number {
  const stepped = Math.round(n * 2) / 2;
  return Math.min(10, Math.max(0.5, stepped));
}

function clampMoveThreshold(n: number): number {
  return Math.min(10_000, Math.max(0.01, Math.round(n * 100) / 100));
}

type MarketVisKey = "gb_power" | "nbp" | "ttf" | "uka" | "eua";

type MarketVisibilityState = Record<MarketVisKey, boolean>;

type AlertApiRow = {
  id: string;
  user_id: string;
  threshold_type: string;
  threshold_value: number | string;
  delivery_channel: string;
  signal_id: string | null;
  created_at: string;
};

function PrefsSwitch({
  checked,
  onClick,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-7 w-[46px] shrink-0 items-center rounded-full border-[0.5px] p-[3px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed ${
        disabled
          ? "cursor-not-allowed border-ivory-border bg-ivory-dark/50 opacity-70"
          : checked
            ? "border-[#1D6B4E] bg-[#1D6B4E]"
            : "border-ivory-border bg-ivory-dark/90"
      }`}
    >
      <span
        className={`pointer-events-none block h-[22px] w-[22px] rounded-full bg-card shadow-[0_1px_2px_rgba(44,42,38,0.14)] ring-0 transition-transform duration-200 ease-out ${
          checked ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

const sectionTitleMarketsClass =
  "text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid";

/** Non-interactive “on” switch (GB Power always visible). Matches PrefsSwitch on-state styling. */
function StaticOnSwitchVisual() {
  return (
    <span
      className="relative inline-flex h-7 w-[46px] shrink-0 cursor-not-allowed items-center rounded-full border-[0.5px] border-[#1D6B4E] bg-[#1D6B4E] p-[3px] opacity-60"
      aria-hidden
    >
      <span className="pointer-events-none block h-[22px] w-[22px] translate-x-[18px] rounded-full bg-card shadow-[0_1px_2px_rgba(44,42,38,0.14)] ring-0" />
    </span>
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

  const defaultVis = useMemo(
    (): MarketVisibilityState => ({
      gb_power: true,
      nbp: true,
      ttf: true,
      uka: true,
      eua: true,
    }),
    [],
  );

  const [bootLoading, setBootLoading] = useState(true);
  const [prefLoadErr, setPrefLoadErr] = useState<string | null>(null);
  const [alertsLoadError, setAlertsLoadError] = useState<string | null>(null);
  const [marketVisibility, setMarketVisibility] =
    useState<MarketVisibilityState>(defaultVis);
  const [visBusy, setVisBusy] = useState(false);
  const [visMsg, setVisMsg] = useState<string | null>(null);
  const [visErr, setVisErr] = useState<string | null>(null);

  const [remitMinMwInput, setRemitMinMwInput] = useState("");
  const [remitUnplannedOnly, setRemitUnplannedOnly] = useState(false);
  const [remitSaving, setRemitSaving] = useState(false);
  const [remitMsg, setRemitMsg] = useState<string | null>(null);
  const [remitErr, setRemitErr] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [inputValue, setInputValue] = useState(DEFAULT_PREMIUM_THRESHOLD);
  const [savedValue, setSavedValue] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [n2exEn, setN2exEn] = useState(false);
  const [n2exIn, setN2exIn] = useState(DEFAULT_N2EX_MOVE);
  const [n2exSv, setN2exSv] = useState<number | null>(null);
  const [ttfEn, setTtfEn] = useState(false);
  const [ttfIn, setTtfIn] = useState(DEFAULT_TTF_MOVE);
  const [ttfSv, setTtfSv] = useState<number | null>(null);
  const [nbpEn, setNbpEn] = useState(false);
  const [nbpIn, setNbpIn] = useState(DEFAULT_NBP_MOVE);
  const [nbpSv, setNbpSv] = useState<number | null>(null);
  const [moveBusy, setMoveBusy] = useState<string | null>(null);

  function hydrateMoveAlert(
    rows: AlertApiRow[],
    type: string,
    def: number,
    setEn: (v: boolean) => void,
    setIn: (v: number) => void,
    setSv: (v: number | null) => void,
  ) {
    const row = rows.find((r) => r.threshold_type === type);
    if (row) {
      const raw = Number(row.threshold_value);
      const v = Number.isFinite(raw) ? clampMoveThreshold(raw) : def;
      setEn(true);
      setIn(v);
      setSv(v);
    } else {
      setEn(false);
      setIn(def);
      setSv(null);
    }
  }

  const loadPanel = useCallback(async () => {
    setBootLoading(true);
    setPrefLoadErr(null);
    setAlertsLoadError(null);
    try {
      const [pr, ar] = await Promise.all([
        fetch("/api/user-preferences"),
        fetch("/api/alerts"),
      ]);
      const prefBody = (await pr.json().catch(() => ({}))) as {
        market_visibility?: MarketVisibilityState;
        remit_min_mw?: number | null;
        remit_unplanned_only?: boolean;
        error?: string;
      };
      const alertBody = (await ar.json().catch(() => ({}))) as {
        alerts?: AlertApiRow[];
        error?: string;
      };

      if (!pr.ok) {
        setPrefLoadErr(prefBody.error ?? pr.statusText);
      } else {
        const mv = prefBody.market_visibility;
        if (mv && typeof mv === "object") {
          setMarketVisibility({
            gb_power: true,
            nbp: Boolean(mv.nbp),
            ttf: Boolean(mv.ttf),
            uka: Boolean(mv.uka),
            eua: Boolean(mv.eua),
          });
        } else {
          setMarketVisibility(defaultVis);
        }
        const rmw = prefBody.remit_min_mw;
        if (rmw != null && Number.isFinite(Number(rmw))) {
          setRemitMinMwInput(String(rmw));
        } else {
          setRemitMinMwInput("");
        }
        setRemitUnplannedOnly(Boolean(prefBody.remit_unplanned_only));
      }

      if (!ar.ok) {
        setAlertsLoadError(alertBody.error ?? ar.statusText);
      } else {
        const rows = alertBody.alerts ?? [];
        const row = rows.find((r) => r.threshold_type === PREMIUM_ALERT_TYPE);
        if (row) {
          const raw = Number(row.threshold_value);
          const v = Number.isFinite(raw)
            ? clampPremiumScoreThreshold(raw)
            : DEFAULT_PREMIUM_THRESHOLD;
          setEnabled(true);
          setInputValue(v);
          setSavedValue(v);
        } else {
          setEnabled(false);
          setInputValue(DEFAULT_PREMIUM_THRESHOLD);
          setSavedValue(null);
        }
        hydrateMoveAlert(
          rows,
          N2EX_MOVE_ALERT_TYPE,
          DEFAULT_N2EX_MOVE,
          setN2exEn,
          setN2exIn,
          setN2exSv,
        );
        hydrateMoveAlert(
          rows,
          TTF_MOVE_ALERT_TYPE,
          DEFAULT_TTF_MOVE,
          setTtfEn,
          setTtfIn,
          setTtfSv,
        );
        hydrateMoveAlert(
          rows,
          NBP_MOVE_ALERT_TYPE,
          DEFAULT_NBP_MOVE,
          setNbpEn,
          setNbpIn,
          setNbpSv,
        );
      }
    } catch (e) {
      setPrefLoadErr(
        e instanceof Error ? e.message : "Could not load preferences",
      );
      setAlertsLoadError(
        e instanceof Error ? e.message : "Could not load alerts",
      );
    } finally {
      setBootLoading(false);
    }
  }, [defaultVis]);

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

  useEffect(() => {
    if (!statusMsg) return;
    const t = setTimeout(() => setStatusMsg(null), 3200);
    return () => clearTimeout(t);
  }, [statusMsg]);

  useEffect(() => {
    if (!visMsg) return;
    const t = setTimeout(() => setVisMsg(null), 2000);
    return () => clearTimeout(t);
  }, [visMsg]);

  useEffect(() => {
    if (!remitMsg) return;
    const t = setTimeout(() => setRemitMsg(null), 3200);
    return () => clearTimeout(t);
  }, [remitMsg]);

  const normalizedInput = clampPremiumScoreThreshold(inputValue);
  const valueDirty =
    enabled &&
    savedValue !== null &&
    normalizedInput !== savedValue;

  const n2exDirty =
    n2exEn && n2exSv !== null && clampMoveThreshold(n2exIn) !== n2exSv;
  const ttfDirty =
    ttfEn && ttfSv !== null && clampMoveThreshold(ttfIn) !== ttfSv;
  const nbpDirty =
    nbpEn && nbpSv !== null && clampMoveThreshold(nbpIn) !== nbpSv;

  const patchMarketKey = useCallback(
    async (key: MarketVisKey, value: boolean) => {
      if (key === "gb_power") return;
      const prev = { ...marketVisibility };
      const next = { ...marketVisibility, [key]: value };
      setMarketVisibility(next);
      setVisBusy(true);
      setVisErr(null);
      try {
        const res = await fetch("/api/user-preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ market_visibility: next }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? res.statusText);
        }
        setVisMsg("Saved");
      } catch (e) {
        setMarketVisibility(prev);
        setVisErr(e instanceof Error ? e.message : "Save failed");
      } finally {
        setVisBusy(false);
      }
    },
    [marketVisibility],
  );

  const saveRemitPrefs = useCallback(async () => {
    setRemitSaving(true);
    setRemitErr(null);
    setRemitMsg(null);
    try {
      const t = remitMinMwInput.trim();
      const remit_min_mw =
        t === "" ? null : Number(t);
      if (remit_min_mw !== null && (!Number.isFinite(remit_min_mw) || remit_min_mw < 0)) {
        throw new Error("Min MW must be empty or a non-negative number.");
      }
      const res = await fetch("/api/user-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remit_min_mw,
          remit_unplanned_only: remitUnplannedOnly,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? res.statusText);
      }
      setRemitMsg("Saved");
    } catch (e) {
      setRemitErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setRemitSaving(false);
    }
  }, [remitMinMwInput, remitUnplannedOnly]);

  const applyPremiumEnabled = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setStatusErr(null);
      setStatusMsg(null);
      try {
        if (next) {
          const v = clampPremiumScoreThreshold(inputValue);
          setInputValue(v);
          const res = await fetch("/api/alerts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threshold_type: PREMIUM_ALERT_TYPE,
              threshold_value: v,
              delivery_channel: "email",
            }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok) {
            throw new Error(body.error ?? res.statusText);
          }
          setEnabled(true);
          setSavedValue(v);
          setStatusMsg("Saved");
        } else {
          const res = await fetch("/api/alerts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threshold_type: PREMIUM_ALERT_TYPE }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok) {
            throw new Error(body.error ?? res.statusText);
          }
          setEnabled(false);
          setSavedValue(null);
          setStatusMsg(null);
        }
      } catch (e) {
        setStatusErr(
          e instanceof Error ? e.message : "Something went wrong",
        );
      } finally {
        setBusy(false);
      }
    },
    [inputValue],
  );

  const savePremiumThreshold = useCallback(async () => {
    if (!enabled || savedValue === null) return;
    setBusy(true);
    setStatusErr(null);
    setStatusMsg(null);
    try {
      const v = clampPremiumScoreThreshold(inputValue);
      setInputValue(v);
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threshold_type: PREMIUM_ALERT_TYPE,
          threshold_value: v,
          delivery_channel: "email",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? res.statusText);
      }
      setSavedValue(v);
      setStatusMsg("Saved");
    } catch (e) {
      setStatusErr(
        e instanceof Error ? e.message : "Could not save",
      );
    } finally {
      setBusy(false);
    }
  }, [enabled, savedValue, inputValue]);

  const applyMoveEnabled = useCallback(
    async (
      thresholdType: string,
      next: boolean,
      inputVal: number,
      setEn: (v: boolean) => void,
      setIn: (v: number) => void,
      setSv: (v: number | null) => void,
    ) => {
      setMoveBusy(thresholdType);
      setStatusErr(null);
      setStatusMsg(null);
      try {
        if (next) {
          const v = clampMoveThreshold(inputVal);
          setIn(v);
          const res = await fetch("/api/alerts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threshold_type: thresholdType,
              threshold_value: v,
              delivery_channel: "email",
            }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok) {
            throw new Error(body.error ?? res.statusText);
          }
          setEn(true);
          setSv(v);
          setStatusMsg("Saved");
        } else {
          const res = await fetch("/api/alerts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threshold_type: thresholdType }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok) {
            throw new Error(body.error ?? res.statusText);
          }
          setEn(false);
          setSv(null);
        }
      } catch (e) {
        setStatusErr(
          e instanceof Error ? e.message : "Something went wrong",
        );
      } finally {
        setMoveBusy(null);
      }
    },
    [],
  );

  const saveMoveThreshold = useCallback(
    async (
      thresholdType: string,
      inputVal: number,
      setIn: (v: number) => void,
      setSv: (v: number | null) => void,
    ) => {
      setMoveBusy(thresholdType);
      setStatusErr(null);
      setStatusMsg(null);
      try {
        const v = clampMoveThreshold(inputVal);
        setIn(v);
        const res = await fetch("/api/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threshold_type: thresholdType,
            threshold_value: v,
            delivery_channel: "email",
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? res.statusText);
        }
        setSv(v);
        setStatusMsg("Saved");
      } catch (e) {
        setStatusErr(
          e instanceof Error ? e.message : "Could not save",
        );
      } finally {
        setMoveBusy(null);
      }
    },
    [],
  );

  const visRows: {
    key: MarketVisKey;
    label: string;
    sub: string;
    lock?: boolean;
  }[] = [
    {
      key: "gb_power",
      label: "GB Power (N2EX Day-Ahead)",
      sub: "N2EX Day-Ahead · Elexon BMRS MID",
      lock: true,
    },
    {
      key: "nbp",
      label: "NBP Natural Gas",
      sub: "NBP equivalent shown in the TTF cost stack",
    },
    { key: "ttf", label: "TTF Natural Gas", sub: "EEX NGP" },
    { key: "uka", label: "Carbon (UKA + CPS)", sub: "UKA + CPS" },
    { key: "eua", label: "EU Gas Storage", sub: "GIE AGSI" },
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

      {bootLoading ? (
        <p className="text-sm text-ink-mid">Loading settings…</p>
      ) : (
        <>
          {prefLoadErr ? (
            <p className="text-sm text-bear" role="alert">
              Preferences: {prefLoadErr}
            </p>
          ) : null}

          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
            <p className={sectionTitleMarketsClass}>Market visibility</p>
            <p className="mt-1 text-xs text-ink-light">
              Choose which markets appear on your Overview and Markets pages.
            </p>
            <div className="mt-5 space-y-4">
              {visRows.map((row) => (
                <div
                  key={row.key}
                  className="flex flex-col gap-3 border-b-[0.5px] border-ivory-border pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{row.label}</p>
                    <p className="mt-0.5 text-xs text-ink-light">{row.sub}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    {row.lock ? (
                      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-medium text-ink-mid">
                        <span>Visible</span>
                        <span className="text-[10px] font-normal text-ink-light">
                          (always on)
                        </span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-ink-mid">
                        Visible
                      </span>
                    )}
                    {row.lock ? (
                      <span
                        className="inline-flex items-center"
                        title="GB Power is always shown"
                      >
                        <span className="sr-only">GB Power is always visible</span>
                        <StaticOnSwitchVisual />
                      </span>
                    ) : (
                      <PrefsSwitch
                        checked={marketVisibility[row.key]}
                        disabled={visBusy}
                        ariaLabel={`Toggle ${row.label} visibility`}
                        onClick={() =>
                          void patchMarketKey(row.key, !marketVisibility[row.key])
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {visErr ? (
              <p className="mt-3 text-xs text-bear" role="alert">
                {visErr}
              </p>
            ) : null}
            {visMsg ? (
              <p className="mt-3 text-xs font-medium text-[#1D6B4E]">{visMsg}</p>
            ) : null}

            <div className="mt-6 border-t-[0.5px] border-ivory-border pt-6">
              <p className={sectionTitleMarketsClass}>REMIT signal filters</p>
              <p className="mt-1 text-xs text-ink-light">
                Default filters applied to your signal feed.
              </p>
              <div className="mt-5 space-y-4">
                <div>
                  <p className="text-sm font-medium text-ink">
                    Only show outages above X MW
                  </p>
                  <p className="mt-1 text-xs text-ink-light">
                    Leave empty to show all sizes.
                  </p>
                  <label htmlFor="remit-min-mw" className="sr-only">
                    Minimum outage size in MW
                  </label>
                  <input
                    id="remit-min-mw"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={remitMinMwInput}
                    onChange={(e) => setRemitMinMwInput(e.target.value)}
                    placeholder="No minimum"
                    className="mt-2 block w-full max-w-xs rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
                  />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">Unplanned outages only</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="text-[11px] font-medium text-ink-mid">
                      Enabled
                    </span>
                    <PrefsSwitch
                      checked={remitUnplannedOnly}
                      disabled={remitSaving}
                      ariaLabel="Unplanned REMIT only"
                      onClick={() => setRemitUnplannedOnly(!remitUnplannedOnly)}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={remitSaving}
                  onClick={() => void saveRemitPrefs()}
                  className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-ink/25 disabled:opacity-60"
                >
                  {remitSaving ? "Saving…" : "Save"}
                </button>
                {remitMsg ? (
                  <span className="text-xs font-medium text-[#1D6B4E]">{remitMsg}</span>
                ) : null}
                {remitErr ? (
                  <span className="text-xs text-bear" role="alert">
                    {remitErr}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-6 border-t-[0.5px] border-ivory-border pt-6">
              <p className={sectionTitleMarketsClass}>Alert thresholds</p>
              <p className="mt-1 text-xs text-ink-light">
                Configure email alerts for key market signals.
              </p>

              {alertsLoadError ? (
                <p className="mt-4 text-sm text-bear" role="alert">
                  {alertsLoadError}
                </p>
              ) : (
                <div className="mt-5 space-y-8">
                <div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 max-w-xl">
                      <p className="text-sm font-medium text-ink">
                        Physical premium score alert
                      </p>
                      <p className="mt-1 text-xs text-ink-light">
                        Email when the physical premium score exceeds your threshold in
                        either direction
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="text-[11px] font-medium text-ink-mid">
                        Enabled
                      </span>
                      <PrefsSwitch
                        checked={enabled}
                        disabled={busy || moveBusy !== null}
                        ariaLabel="Enable physical premium score email alert"
                        onClick={() => void applyPremiumEnabled(!enabled)}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                    <div>
                      <label
                        htmlFor="premium-score-threshold"
                        className="text-[9px] font-semibold tracking-[0.12em] text-ink-mid"
                      >
                        <span className="uppercase tracking-[0.12em]">Threshold</span>
                      </label>
                      <input
                        id="premium-score-threshold"
                        type="number"
                        min={0.5}
                        max={10}
                        step={0.5}
                        disabled={!enabled || busy || moveBusy !== null}
                        value={inputValue}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setInputValue(Number.isFinite(n) ? n : inputValue);
                        }}
                        onBlur={() =>
                          setInputValue((v) => clampPremiumScoreThreshold(v))
                        }
                        className="mt-1 block w-[120px] rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                    {valueDirty ? (
                      <button
                        type="button"
                        disabled={busy || moveBusy !== null}
                        onClick={() => void savePremiumThreshold()}
                        className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-ink/25 disabled:opacity-60"
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 max-w-xl">
                      <p className="text-sm font-medium text-ink">N2EX daily move alert</p>
                      <p className="mt-1 text-xs text-ink-light">
                        Email when N2EX daily average moves more than £X/MWh vs previous day
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="text-[11px] font-medium text-ink-mid">Enabled</span>
                      <PrefsSwitch
                        checked={n2exEn}
                        disabled={busy || moveBusy !== null}
                        ariaLabel="N2EX daily move alert"
                        onClick={() =>
                          void applyMoveEnabled(
                            N2EX_MOVE_ALERT_TYPE,
                            !n2exEn,
                            n2exIn,
                            setN2exEn,
                            setN2exIn,
                            setN2exSv,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                    <div>
                      <label
                        htmlFor="n2ex-move-threshold"
                        className="text-[9px] font-semibold tracking-[0.12em] text-ink-mid"
                      >
                        <span className="uppercase tracking-[0.12em]">Threshold</span>
                        <span className="font-semibold normal-case"> (£/MWh)</span>
                      </label>
                      <input
                        id="n2ex-move-threshold"
                        type="number"
                        min={0.01}
                        step={0.01}
                        disabled={!n2exEn || busy || moveBusy !== null}
                        value={n2exIn}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setN2exIn(Number.isFinite(n) ? n : n2exIn);
                        }}
                        onBlur={() => setN2exIn((v) => clampMoveThreshold(v))}
                        className="mt-1 block w-[120px] rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                    {n2exDirty ? (
                      <button
                        type="button"
                        disabled={busy || moveBusy !== null}
                        onClick={() =>
                          void saveMoveThreshold(
                            N2EX_MOVE_ALERT_TYPE,
                            n2exIn,
                            setN2exIn,
                            setN2exSv,
                          )
                        }
                        className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-ink/25 disabled:opacity-60"
                      >
                        {moveBusy === N2EX_MOVE_ALERT_TYPE ? "Saving…" : "Save"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 max-w-xl">
                      <p className="text-sm font-medium text-ink">TTF daily move alert</p>
                      <p className="mt-1 text-xs text-ink-light">
                        Email when TTF moves more than €X/MWh day-on-day
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="text-[11px] font-medium text-ink-mid">Enabled</span>
                      <PrefsSwitch
                        checked={ttfEn}
                        disabled={busy || moveBusy !== null}
                        ariaLabel="TTF daily move alert"
                        onClick={() =>
                          void applyMoveEnabled(
                            TTF_MOVE_ALERT_TYPE,
                            !ttfEn,
                            ttfIn,
                            setTtfEn,
                            setTtfIn,
                            setTtfSv,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                    <div>
                      <label
                        htmlFor="ttf-move-threshold"
                        className="text-[9px] font-semibold tracking-[0.12em] text-ink-mid"
                      >
                        <span className="uppercase tracking-[0.12em]">Threshold</span>
                        <span className="font-semibold normal-case"> (€/MWh)</span>
                      </label>
                      <input
                        id="ttf-move-threshold"
                        type="number"
                        min={0.01}
                        step={0.01}
                        disabled={!ttfEn || busy || moveBusy !== null}
                        value={ttfIn}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setTtfIn(Number.isFinite(n) ? n : ttfIn);
                        }}
                        onBlur={() => setTtfIn((v) => clampMoveThreshold(v))}
                        className="mt-1 block w-[120px] rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                    {ttfDirty ? (
                      <button
                        type="button"
                        disabled={busy || moveBusy !== null}
                        onClick={() =>
                          void saveMoveThreshold(
                            TTF_MOVE_ALERT_TYPE,
                            ttfIn,
                            setTtfIn,
                            setTtfSv,
                          )
                        }
                        className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-ink/25 disabled:opacity-60"
                      >
                        {moveBusy === TTF_MOVE_ALERT_TYPE ? "Saving…" : "Save"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 max-w-xl">
                      <p className="text-sm font-medium text-ink">NBP daily move alert</p>
                      <p className="mt-1 text-xs text-ink-light">
                        Email when NBP moves more than Xp/therm day-on-day
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="text-[11px] font-medium text-ink-mid">Enabled</span>
                      <PrefsSwitch
                        checked={nbpEn}
                        disabled={busy || moveBusy !== null}
                        ariaLabel="NBP daily move alert"
                        onClick={() =>
                          void applyMoveEnabled(
                            NBP_MOVE_ALERT_TYPE,
                            !nbpEn,
                            nbpIn,
                            setNbpEn,
                            setNbpIn,
                            setNbpSv,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                    <div>
                      <label
                        htmlFor="nbp-move-threshold"
                        className="text-[9px] font-semibold tracking-[0.12em] text-ink-mid"
                      >
                        <span className="uppercase tracking-[0.12em]">Threshold</span>
                        <span className="font-semibold normal-case"> (p/therm)</span>
                      </label>
                      <input
                        id="nbp-move-threshold"
                        type="number"
                        min={0.01}
                        step={0.01}
                        disabled={!nbpEn || busy || moveBusy !== null}
                        value={nbpIn}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setNbpIn(Number.isFinite(n) ? n : nbpIn);
                        }}
                        onBlur={() => setNbpIn((v) => clampMoveThreshold(v))}
                        className="mt-1 block w-[120px] rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                    {nbpDirty ? (
                      <button
                        type="button"
                        disabled={busy || moveBusy !== null}
                        onClick={() =>
                          void saveMoveThreshold(
                            NBP_MOVE_ALERT_TYPE,
                            nbpIn,
                            setNbpIn,
                            setNbpSv,
                          )
                        }
                        className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-ink/25 disabled:opacity-60"
                      >
                        {moveBusy === NBP_MOVE_ALERT_TYPE ? "Saving…" : "Save"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {statusErr ? (
                  <p className="text-xs text-bear" role="alert">
                    {statusErr}
                  </p>
                ) : null}
                {statusMsg ? (
                  <p className="text-xs font-medium text-[#1D6B4E]">{statusMsg}</p>
                ) : null}
              </div>
            )}
            </div>
          </div>
        </>
      )}
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
  invite_url?: string | null;
};

type TeamConfirmAction =
  | { kind: "remove-member"; userId: string; label: string }
  | { kind: "leave-team" }
  | { kind: "cancel-invite"; inviteId: string; invitedEmail: string };

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
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [cancellingInviteId, setCancellingInviteId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [leavingTeam, setLeavingTeam] = useState(false);
  const [confirmAction, setConfirmAction] = useState<TeamConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [data, setData] = useState<{
    team: { id: string; name: string; owner_id?: string; created_at?: string } | null;
    members: TeamMemberRow[];
    invitations: Array<InvitationRow & { token?: string }>;
    seatLimit: number | "unlimited";
    usedSeats: number;
    isOwner?: boolean;
    viewerRole?: "owner" | "member" | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/team/members");
      const body = (await res.json()) as {
        error?: string;
        team?: { id: string; name: string; owner_id?: string } | null;
        members?: TeamMemberRow[];
        invitations?: Array<InvitationRow & { token?: string }>;
        seatLimit?: number | "unlimited";
        usedSeats?: number;
        isOwner?: boolean;
        viewerRole?: "owner" | "member" | null;
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
        isOwner: body.isOwner === true,
        viewerRole: body.viewerRole ?? null,
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
    setInviteError(null);
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
        inviteEmailSent?: boolean;
        inviteEmailSkipped?: boolean;
        inviteAlreadyPending?: boolean;
        inviteEmailError?: string;
      };
      if (!res.ok) {
        if (res.status === 409 && body.code === "SEAT_LIMIT_REACHED") {
          throw new Error(
            body.error ??
              "No seats left on this team plan. Remove a pending invite/member, then try again.",
          );
        }
        throw new Error(body.error ?? "Could not send invite");
      }
      setInviteEmail("");
      if (body.inviteAlreadyPending) {
        setCopyMsg(
          "An invite was already pending for this email. We reused it and resent the invite email.",
        );
        setTimeout(() => setCopyMsg(null), 7000);
      } else if (body.inviteEmailSkipped) {
        setCopyMsg(
          "Invite created. Add RESEND_API_KEY to send email automatically, or copy the link below.",
        );
        setTimeout(() => setCopyMsg(null), 6000);
      } else if (body.inviteEmailSent) {
        setCopyMsg(
          "Invite email sent from noreply@zephyr.markets. You can still copy the link below if needed.",
        );
        setTimeout(() => setCopyMsg(null), 5000);
      } else if (body.inviteEmailError) {
        setCopyMsg(
          `Invite saved, but email failed to send (${body.inviteEmailError}). Copy the link below or check Resend logs.`,
        );
        setTimeout(() => setCopyMsg(null), 10000);
      }
      await load();
    } catch (e: unknown) {
      setInviteError(
        e instanceof Error
          ? e.message
          : "Could not send invite. Please check the email and try again.",
      );
    } finally {
      setInviting(false);
    }
  }

  function copyInviteLink(url: string) {
    void navigator.clipboard.writeText(url);
    setCopyMsg("Invite link copied to clipboard.");
    setTimeout(() => setCopyMsg(null), 4000);
  }

  async function removeMember(targetUserId: string) {
    setRemovingUserId(targetUserId);
    setError(null);
    setCopyMsg(null);
    try {
      const res = await fetch(
        `/api/team/members/${encodeURIComponent(targetUserId)}`,
        { method: "DELETE" },
      );
      const body = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not remove member");
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not remove member");
    } finally {
      setRemovingUserId(null);
    }
  }

  async function cancelInvite(inviteId: string) {
    setCancellingInviteId(inviteId);
    setInviteError(null);
    setCopyMsg(null);
    try {
      const res = await fetch(
        `/api/team/invitations/${encodeURIComponent(inviteId)}`,
        { method: "DELETE" },
      );
      const body = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        if (res.status === 409 && body.code === "INVITE_NOT_PENDING") {
          throw new Error(
            body.error ?? "This invitation is no longer pending.",
          );
        }
        throw new Error(body.error ?? "Could not cancel invitation");
      }
      setCopyMsg("Invitation cancelled.");
      setTimeout(() => setCopyMsg(null), 5000);
      await load();
    } catch (e: unknown) {
      setInviteError(
        e instanceof Error ? e.message : "Could not cancel invitation",
      );
    } finally {
      setCancellingInviteId(null);
    }
  }

  const seatLimit = data?.seatLimit ?? "—";
  const usedSeats = data?.usedSeats ?? "—";
  const isOwner = data?.isOwner === true;
  const viewerRole = data?.viewerRole ?? null;

  async function runConfirmedAction() {
    const action = confirmAction;
    if (!action) return;
    setConfirmBusy(true);
    try {
      if (action.kind === "remove-member") {
        await removeMember(action.userId);
      } else if (action.kind === "leave-team") {
        await leaveTeamFromTeamTab();
      } else {
        await cancelInvite(action.inviteId);
      }
      setConfirmAction(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  async function leaveTeamFromTeamTab() {
    setLeavingTeam(true);
    setError(null);
    setCopyMsg(null);
    try {
      const res = await fetch("/api/team/leave", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not leave team.");
      }
      window.location.reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not leave team.");
      setLeavingTeam(false);
    }
  }

  function closeConfirm() {
    if (confirmBusy) return;
    setConfirmAction(null);
  }

  useEffect(() => {
    if (!confirmAction) return;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      cancelBtnRef.current?.focus();
      modalRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [confirmAction]);

  useEffect(() => {
    if (confirmAction) return;
    lastFocusedRef.current?.focus?.();
  }, [confirmAction]);

  return (
    <>
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
          {viewerRole === "member"
            ? "You’re a member of this team. Invite links are managed by the team owner."
            : viewerRole === "owner"
            ? "Create a team, invite colleagues by email, and share seats. Invitees open the link below (or paste it after signing in with the invited address)."
            : "You’re not on a team right now. Create a team to invite colleagues and share seats."}
        </p>
        {loading ? (
          <p className="mt-3 text-xs text-ink-light">Loading team…</p>
        ) : null}
        {error ? <p className="mt-3 text-xs text-bear">{error}</p> : null}
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
                  suggestedTeamName || "e.g. Dean's Team"
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
            {isOwner ? (
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
            ) : (
              <p className="mt-2 font-serif text-xl text-ink">{data.team.name}</p>
            )}
            <p className="mt-3 font-mono text-[11px] text-ink-light">
              Seats: {String(usedSeats)} / {String(seatLimit)}
            </p>
            {!isOwner ? (
              <button
                type="button"
                disabled={leavingTeam}
                onClick={() => setConfirmAction({ kind: "leave-team" })}
                className="mt-4 inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-bear/40 bg-card px-4 text-xs font-semibold tracking-[0.08em] text-bear transition-colors hover:bg-bear/10 disabled:opacity-60"
              >
                {leavingTeam ? "Leaving…" : "Leave team"}
              </button>
            ) : null}
          </div>

          {isOwner ? (
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
            {inviteError ? (
              <p className="mt-3 text-xs text-bear">{inviteError}</p>
            ) : null}
            {copyMsg ? <p className="mt-2 text-xs text-bull">{copyMsg}</p> : null}
          </div>
          ) : null}

          {isOwner ? (
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
                    {inv.invite_url ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyInviteLink(inv.invite_url!)}
                          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-mid transition-colors hover:bg-ivory-dark hover:text-ink"
                        >
                          Copy invite link
                        </button>
                        <button
                          type="button"
                          disabled={cancellingInviteId === inv.id}
                          onClick={() =>
                            setConfirmAction({
                              kind: "cancel-invite",
                              inviteId: inv.id,
                              invitedEmail: inv.invited_email,
                            })
                          }
                          className="rounded-[4px] border-[0.5px] border-bear/40 bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-bear transition-colors hover:bg-bear/10 disabled:opacity-60"
                        >
                          {cancellingInviteId === inv.id ? "Cancelling…" : "Cancel"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          ) : null}

          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Members
            </p>
            {data.members.length === 0 ? (
              <p className="mt-3 text-sm text-ink-mid">No members yet.</p>
            ) : (
              <ul className="mt-4 divide-y-[0.5px] divide-ivory-border">
                {data.members.map((m) => {
                  const ownerId = data.team?.owner_id;
                  const isOwnerRow =
                    (ownerId != null && m.user_id === ownerId) || m.role === "owner";
                  const label =
                    m.display_name ?? `${m.user_id.slice(0, 8)}…`;
                  return (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-ink"
                    >
                      <div>
                        <span className="text-ink">{label}</span>
                        <span className="ml-2 text-ink-light">
                          {m.role} · {m.status}
                        </span>
                      </div>
                      {isOwner && !isOwnerRow ? (
                        <button
                          type="button"
                          disabled={removingUserId === m.user_id}
                          onClick={() =>
                            setConfirmAction({
                              kind: "remove-member",
                              userId: m.user_id,
                              label,
                            })
                          }
                          className="shrink-0 rounded-[4px] border-[0.5px] border-bear/40 bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-bear transition-colors hover:bg-bear/10 disabled:opacity-60"
                        >
                          {removingUserId === m.user_id ? "Removing…" : "Remove"}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
      </motion.div>
      {confirmAction ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm action"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeConfirm();
            }
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeConfirm();
          }}
        >
          <span
            tabIndex={0}
            onFocus={() => confirmBtnRef.current?.focus()}
            className="sr-only"
          />
          <div
            ref={modalRef}
            tabIndex={-1}
            className="w-full max-w-md rounded-[4px] border-[0.5px] border-ivory-border bg-card p-5 outline-none"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
              Confirm action
            </p>
            <p className="mt-2 text-sm text-ink">
              {confirmAction.kind === "remove-member"
                ? `Remove ${confirmAction.label} from this team? They will lose access to team features.`
                : confirmAction.kind === "leave-team"
                  ? "Leave this team? You will lose team features and return to the Free plan until you subscribe yourself."
                  : `Cancel the pending invite for ${confirmAction.invitedEmail}?`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                ref={cancelBtnRef}
                disabled={confirmBusy}
                onClick={closeConfirm}
                className="inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 text-xs font-semibold tracking-[0.08em] text-ink-mid transition-colors hover:bg-ivory-dark hover:text-ink"
              >
                Keep
              </button>
              <button
                type="button"
                ref={confirmBtnRef}
                disabled={confirmBusy}
                onClick={() => void runConfirmedAction()}
                className="inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-bear/40 bg-card px-4 text-xs font-semibold tracking-[0.08em] text-bear transition-colors hover:bg-bear/10"
              >
                {confirmBusy
                  ? "Working…"
                  : confirmAction.kind === "cancel-invite"
                    ? "Cancel invite"
                    : "Confirm"}
              </button>
            </div>
          </div>
          <span
            tabIndex={0}
            onFocus={() => cancelBtnRef.current?.focus()}
            className="sr-only"
          />
        </div>
      ) : null}
    </>
  );
}

type ApiKeyRow = {
  id: string;
  keyPrefix: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  requestCount: number;
};

function formatApiKeyWhen(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatApiKeyCreated(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function PlanApiPanel() {
  const pro = TIER_ENTITLEMENTS.pro;
  const team = TIER_ENTITLEMENTS.team;
  const [billingStatus, setBillingStatus] = useState<{
    effectiveTier: "free" | "pro" | "team";
    status: string;
    statusLabel: string;
    interval: "monthly" | "annual" | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    accessState: "paid" | "grace" | "free";
    actionRequired: "none" | "payment_method" | "new_subscription";
    canUsePremiumNow: boolean;
    teamMemberOfOwnerId: string | null;
  } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [startingCheckout, setStartingCheckout] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [revealKeyModal, setRevealKeyModal] = useState<{
    rawKey: string;
    keyPrefix: string;
    createdAt: string;
  } | null>(null);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [copyKeyFlash, setCopyKeyFlash] = useState(false);

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
          effectiveTier: "free" | "pro" | "team";
          status: string;
          statusLabel: string;
          interval: "monthly" | "annual" | null;
          currentPeriodEnd: string | null;
          cancelAtPeriodEnd: boolean;
          accessState: "paid" | "grace" | "free";
          actionRequired: "none" | "payment_method" | "new_subscription";
          canUsePremiumNow: boolean;
          teamMemberOfOwnerId?: string | null;
        };
        if (!cancelled)
          setBillingStatus({
            ...body,
            teamMemberOfOwnerId: body.teamMemberOfOwnerId ?? null,
          });
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
  const isAdmin = billingStatus?.status === "admin";
  const isPaidTier =
    currentTierCode === "pro" || currentTierCode === "team";
  const isTeamSeat = Boolean(billingStatus?.teamMemberOfOwnerId);
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

  async function openPortal(mode: "manage" | "update_subscription" = "manage") {
    setOpeningPortal(true);
    setStatusError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
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

  const canManageApiKeys = currentTierCode === "team" || isAdmin;

  const loadApiKeys = useCallback(async () => {
    if (!canManageApiKeys) return;
    setKeysLoading(true);
    setKeysError(null);
    try {
      const res = await fetch("/api/v1/keys");
      const data: unknown = await res.json();
      if (!res.ok) {
        const errBody = data as { error?: string };
        throw new Error(errBody.error ?? "Could not load API keys");
      }
      setApiKeys(Array.isArray(data) ? (data as ApiKeyRow[]) : []);
    } catch (e: unknown) {
      setKeysError(
        e instanceof Error ? e.message : "Could not load API keys",
      );
      setApiKeys([]);
    } finally {
      setKeysLoading(false);
    }
  }, [canManageApiKeys]);

  useEffect(() => {
    if (loadingStatus || !canManageApiKeys) return;
    void loadApiKeys();
  }, [loadingStatus, canManageApiKeys, loadApiKeys]);

  async function generateApiKey() {
    setGeneratingKey(true);
    setKeysError(null);
    try {
      const res = await fetch("/api/v1/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as {
        rawKey?: string;
        keyPrefix?: string;
        createdAt?: string;
        error?: string;
      };
      if (!res.ok || !body.rawKey) {
        throw new Error(body.error ?? "Could not create API key");
      }
      setRevealKeyModal({
        rawKey: body.rawKey,
        keyPrefix: body.keyPrefix ?? "",
        createdAt: body.createdAt ?? new Date().toISOString(),
      });
    } catch (e: unknown) {
      setKeysError(
        e instanceof Error ? e.message : "Could not create API key",
      );
    } finally {
      setGeneratingKey(false);
    }
  }

  async function revokeApiKey(id: string) {
    if (
      !confirm(
        "Revoke this API key? Clients using it will stop working immediately. This cannot be undone.",
      )
    ) {
      return;
    }
    setRevokingKeyId(id);
    setKeysError(null);
    try {
      const res = await fetch("/api/v1/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not revoke API key");
      }
      await loadApiKeys();
    } catch (e: unknown) {
      setKeysError(
        e instanceof Error ? e.message : "Could not revoke API key",
      );
    } finally {
      setRevokingKeyId(null);
    }
  }

  async function copyRevealKeyToClipboard() {
    if (!revealKeyModal) return;
    try {
      await navigator.clipboard.writeText(revealKeyModal.rawKey);
      setCopyKeyFlash(true);
      window.setTimeout(() => setCopyKeyFlash(false), 2000);
    } catch {
      setKeysError("Could not copy to clipboard.");
    }
  }

  const endpoints = [
    {
      method: "GET",
      path: "/api/v1/premium",
      desc: "Latest physical premium score",
    },
    {
      method: "GET",
      path: "/api/v1/signals",
      desc: "REMIT signal feed",
    },
    {
      method: "GET",
      path: "/api/v1/markets",
      desc: "Market prices — N2EX, TTF, NBP",
    },
    {
      method: "GET",
      path: "/api/v1/storage",
      desc: "EU gas storage levels",
    },
    {
      method: "GET",
      path: "/api/v1/weather",
      desc: "GB wind and solar forecast",
    },
  ];

  return (
    <>
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
            <p className="font-serif text-2xl text-ink">
              {isAdmin ? "Admin" : currentTier.label}
            </p>
            {isAdmin ? (
              <p className="mt-1 text-xs text-ink-light">
                Platform administrator account.
              </p>
            ) : null}
            {!isAdmin && isTeamSeat ? (
              <p className="mt-1 text-xs text-ink-light">
                Team seat — your access follows your team&apos;s subscription.
              </p>
            ) : null}
            {!isAdmin && billingStatus?.interval ? (
              <p className="mt-1 text-xs text-ink-light">
                Billing interval:{" "}
                {billingStatus.interval === "annual" ? "Annual" : "Monthly"}
              </p>
            ) : null}
            {!isAdmin && periodEndLabel ? (
              <p className="mt-1 text-xs text-ink-light">
                Current period end: {periodEndLabel}
              </p>
            ) : null}
            {!isAdmin && billingStatus?.cancelAtPeriodEnd ? (
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
        {!isAdmin ? (
          <p className="mt-3 text-xs text-ink-light">
            {isTeamSeat
              ? "Only the team owner can change payment method or subscription. Leave the team if you need your own billing."
              : isPaidTier
                ? "Manage billing in Stripe for payment method, invoices, and subscription changes available on your account. You will be sent back to Overview when you finish in Stripe."
                + " If you decide not to continue, use the Return link in Stripe’s left sidebar."
                : "Subscribe in the section below to unlock premium."}
          </p>
        ) : null}
        {isPaidTier && !isTeamSeat && !isAdmin ? (
          <button
            type="button"
            disabled={openingPortal}
            onClick={() => {
              void openPortal("manage");
            }}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
          >
            {openingPortal ? "Opening…" : "Manage billing"}
          </button>
        ) : null}
        {!isAdmin &&
        !isPaidTier &&
        !isTeamSeat &&
        billingStatus?.actionRequired === "payment_method" ? (
          <button
            type="button"
            disabled={openingPortal}
            onClick={() => {
              void openPortal("manage");
            }}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
          >
            {openingPortal ? "Opening…" : "Update payment method"}
          </button>
        ) : null}
      </div>

      {!isAdmin && currentTierCode === "free" ? (
        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Choose a plan
          </p>
          <p className="mt-2 text-xs text-ink-light">
            New subscriptions use Stripe Checkout. After payment you&apos;ll return
            to Overview with a confirmation.
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
                Real-time signals, all markets, unlimited positions.
              </p>
              <button
                type="button"
                onClick={() => startCheckout("pro", "monthly")}
                disabled={startingCheckout != null}
                className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-[4px] bg-gold text-xs font-semibold tracking-[0.08em] text-ivory transition-colors hover:bg-[#7a5f1a] disabled:opacity-60"
              >
                {startingCheckout === "pro-monthly"
                  ? "Redirecting..."
                  : "Subscribe to Pro"}
              </button>
              <button
                type="button"
                onClick={() => startCheckout("pro", "annual")}
                disabled={startingCheckout != null}
                className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-[4px] border-[0.5px] border-gold/45 bg-ivory text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
              >
                {startingCheckout === "pro-annual"
                  ? "Redirecting..."
                  : "Pro annual (£390/year)"}
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
                {startingCheckout === "team-monthly"
                  ? "Redirecting..."
                  : "Subscribe to Team"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!isAdmin && currentTierCode === "team" && !isTeamSeat ? (
        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Plan changes
          </p>
          <p className="mt-2 text-xs text-ink-light">
            You&apos;re on {currentTier.label}. Use{" "}
            <strong className="font-semibold text-ink">Manage billing</strong>{" "}
            above to update payment details, download invoices, or adjust what
            Stripe allows for this subscription.
          </p>
        </div>
      ) : null}

      {statusError ? (
        <div className="rounded-[4px] border-[0.5px] border-bear/25 bg-bear/5 px-4 py-3">
          <p className="text-xs text-bear">{statusError}</p>
        </div>
      ) : null}

      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            API keys
          </p>
          {canManageApiKeys ? (
            <>
              <p className="mt-1 text-xs text-ink-light">
                Create and revoke keys for the REST API. Send the{" "}
                <span className="font-mono text-[10px] text-ink-mid">
                  X-API-Key
                </span>{" "}
                header on each request.
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  disabled={generatingKey}
                  onClick={() => void generateApiKey()}
                  className="inline-flex h-9 items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark disabled:opacity-60"
                >
                  {generatingKey ? "Generating…" : "Generate API key"}
                </button>
              </div>
              {keysLoading ? (
                <p className="mt-4 text-xs text-ink-light">Loading keys…</p>
              ) : null}
              {keysError ? (
                <p className="mt-3 text-xs text-bear" role="alert">
                  {keysError}
                </p>
              ) : null}
              {!keysLoading && !keysError && apiKeys.length === 0 ? (
                <p className="mt-4 text-sm text-ink-mid">No API keys yet.</p>
              ) : null}
              {apiKeys.length > 0 ? (
                <ul className="mt-4 divide-y-[0.5px] divide-ivory-border">
                  {apiKeys.map((k) => (
                    <li
                      key={k.id}
                      className="flex flex-wrap items-start justify-between gap-3 py-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[11px] text-ink">
                          {k.keyPrefix}…
                          {k.name && k.name !== "Default" ? (
                            <span className="ml-2 font-sans text-[10px] text-ink-light">
                              ({k.name})
                            </span>
                          ) : null}
                        </p>
                        <div className="mt-2 grid gap-1 text-[11px] text-ink-mid sm:grid-cols-2">
                          <p>
                            <span className="text-ink-light">Created</span>{" "}
                            {formatApiKeyCreated(k.createdAt)}
                          </p>
                          <p>
                            <span className="text-ink-light">Last used</span>{" "}
                            {formatApiKeyWhen(k.lastUsedAt)}
                          </p>
                          <p className="sm:col-span-2">
                            <span className="text-ink-light">Requests</span>{" "}
                            {k.requestCount}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={revokingKeyId === k.id}
                        onClick={() => void revokeApiKey(k.id)}
                        className="shrink-0 rounded-[4px] border-[0.5px] border-bear/40 bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-bear transition-colors hover:bg-bear/10 disabled:opacity-60"
                      >
                        {revokingKeyId === k.id ? "Revoking…" : "Revoke"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-mid">
              API access is available on the Team plan.{" "}
              <button
                type="button"
                onClick={() => startCheckout("team", "monthly")}
                disabled={startingCheckout != null}
                className="font-semibold text-gold underline decoration-gold/40 underline-offset-2 transition-colors hover:opacity-90 disabled:opacity-60"
              >
                Upgrade to Team
              </button>
            </p>
          )}
      </div>

      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-6">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          API access
        </p>
        <p className="mt-1 text-xs text-ink-light">
          {isAdmin
            ? "REST API access for your administrator account. Use the keys above with the X-API-Key header."
            : "Full REST API available on the Team plan. Programmatic access to all Zephyr data feeds."}
        </p>
        <Link
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-mid transition-colors hover:text-ink"
        >
          View API docs →
        </Link>
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
          {isAdmin
            ? "5 endpoints live."
            : currentTierCode === "team"
              ? "5 endpoints live."
              : "API access is unlocked on Team plan and above."}
        </p>
      </div>
    </motion.div>
    {revealKeyModal ? (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-api-key-title"
      >
        <div className="w-full max-w-lg rounded-[4px] border-[0.5px] border-ivory-border bg-card p-6 shadow-none outline-none">
          <p
            id="new-api-key-title"
            className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
          >
            Save your API key
          </p>
          <p className="mt-2 text-sm font-medium text-bear">
            This key will not be shown again. Copy it now and store it securely.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <input
              readOnly
              value={revealKeyModal.rawKey}
              className="min-w-0 flex-1 rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 font-mono text-[11px] text-ink"
              aria-label="New API key"
            />
            <button
              type="button"
              onClick={() => void copyRevealKeyToClipboard()}
              className="shrink-0 rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark"
            >
              {copyKeyFlash ? "Copied" : "Copy to clipboard"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setRevealKeyModal(null);
              void loadApiKeys();
            }}
            className="mt-5 inline-flex h-9 items-center justify-center rounded-[4px] bg-ink px-5 text-xs font-semibold tracking-[0.08em] text-ivory transition-colors hover:bg-[#1f1d1a]"
          >
            Done
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}
