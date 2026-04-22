"use client";

import { TopoBackground } from "@/components/ui/TopoBackground";
import { createBrowserClient } from "@/lib/supabase/client";
import { initialsFromUser } from "@/lib/team/user-initials";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const primary = [
  { href: "/dashboard/overview", label: "Overview" },
  { href: "/dashboard/intelligence/signals", label: "Intelligence" },
  { href: "/dashboard/portfolio/book", label: "Portfolio" },
  { href: "/dashboard/brief", label: "Brief" },
] as const;

const intelligenceSecondary = [
  { href: "/dashboard/intelligence/signals", label: "Signal Feed" },
  { href: "/dashboard/intelligence/weather", label: "Weather" },
  { href: "/dashboard/intelligence/markets", label: "Markets" },
] as const;

const portfolioSecondary = [
  { href: "/dashboard/portfolio/book", label: "Book" },
  { href: "/dashboard/portfolio/attribution", label: "Attribution" },
  { href: "/dashboard/portfolio/risk", label: "Risk" },
  { href: "/dashboard/portfolio/optimise", label: "Optimise" },
] as const;

function navActive(pathname: string, href: string) {
  if (href === "/dashboard/overview") {
    return pathname === "/dashboard/overview";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function sectionActive(
  pathname: string,
  base: "/dashboard/intelligence" | "/dashboard/portfolio",
) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function normalizeRole(role: string | null | undefined): string | null {
  if (!role) return null;
  const normalized = role.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function tierBadgeLabel(
  tier: "free" | "pro" | "team" | null,
): "pro" | "team" | null {
  if (tier === "pro" || tier === "team") return tier;
  return null;
}

/** Session snapshot from the server layout so the chrome matches the signed-in user on first paint. */
export type DashboardInitialAuth = {
  email: string | null;
  initials: string;
  isAppAdmin: boolean;
};

export function DashboardChrome({
  children,
  initialAuth = null,
}: {
  children: React.ReactNode;
  /** When set (dashboard RSC), avoids placeholder avatar until client auth resolves. */
  initialAuth?: DashboardInitialAuth | null;
}) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState<string | null>(
    initialAuth?.email ?? null,
  );
  const [avatarInitials, setAvatarInitials] = useState(
    initialAuth?.initials ?? "U",
  );
  const [profileRole, setProfileRole] = useState<string | null>(() =>
    initialAuth?.isAppAdmin ? "admin" : null,
  );
  const [effectiveTier, setEffectiveTier] = useState<
    "free" | "pro" | "team" | null
  >(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const showIntel = sectionActive(pathname, "/dashboard/intelligence");
  const showPortfolio = sectionActive(pathname, "/dashboard/portfolio");
  const canSeeAdmin = normalizeRole(profileRole) === "admin";
  const primaryNav = canSeeAdmin
    ? [...primary, { href: "/dashboard/admin", label: "Admin" as const }]
    : primary;
  const badge =
    normalizeRole(profileRole) === "admin" ? "admin" : tierBadgeLabel(effectiveTier);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUserEmail(data.user?.email ?? null);
      setAvatarInitials(initialsFromUser(data.user ?? null));
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    let active = true;
    void fetch("/api/billing/status")
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as {
          effectiveTier?: "free" | "pro" | "team";
        };
        return body.effectiveTier ?? null;
      })
      .then((tier) => {
        if (!active) return;
        setEffectiveTier(tier);
      })
      .catch(() => {
        if (!active) return;
        setEffectiveTier(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!active || !userData.user) return;
      const appRole = normalizeRole(
        (userData.user.app_metadata as { role?: string } | undefined)?.role ?? null,
      );
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .single();
      if (!active) return;
      const profileRoleNorm = normalizeRole(data?.role);
      // Trust app_metadata admin (same as middleware); do not overwrite with a null profile role.
      const effective =
        appRole === "admin" || profileRoleNorm === "admin"
          ? "admin"
          : profileRoleNorm;
      setProfileRole(effective);
    }
    void load().catch(() => {
      if (!active) return;
      setProfileRole(null);
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  async function handleSignOut() {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setSigningOut(false);
      window.alert(
        "Could not sign out completely. Try again, or clear site cookies for this domain.",
      );
      return;
    }
    window.location.assign("/login");
  }

  return (
    <div className="min-h-screen bg-ivory">
      <header className="sticky top-0 z-40 border-b-[0.5px] border-ivory-border bg-ivory/95 backdrop-blur-[2px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-14 overflow-hidden">
          <TopoBackground className="h-full w-full" lineOpacity={0.25} />
        </div>
        <div className="relative z-20 mx-auto flex h-14 max-w-[1536px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/dashboard/overview" className="shrink-0">
            <span className="flex items-baseline gap-2">
              <span className="font-serif text-xl tracking-tight text-ink">Zephyr</span>
              <span className="inline-flex min-w-8">
                {badge ? (
                  <span className="rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                    {badge}
                  </span>
                ) : null}
              </span>
            </span>
          </Link>
          <nav
            className="-mx-1 flex flex-1 items-center justify-start gap-0.5 overflow-x-auto px-1 md:justify-center"
            aria-label="Primary"
          >
            {primaryNav.map((item) => {
              const active = navActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 rounded-[4px] px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] transition-colors duration-200 sm:px-3 sm:text-xs sm:tracking-[0.12em] ${
                    active
                      ? "bg-ivory-dark text-ink"
                      : "text-ink-mid hover:bg-ivory-dark/70 hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="relative flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex size-9 items-center justify-center rounded-full border-[0.5px] border-ivory-border bg-card font-serif text-xs font-semibold tracking-tight text-ink"
              aria-label="Account menu"
            >
              {avatarInitials}
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-11 z-20 w-64 rounded-[4px] border-[0.5px] border-ivory-border bg-card p-2">
                <p className="px-2 py-1 text-[11px] text-ink-mid">
                  {userEmail ?? "Signed in"}
                </p>
                <Link
                  href="/dashboard/settings"
                  onClick={() => setMenuOpen(false)}
                  className="mt-1 block rounded-[4px] px-2 py-2 text-xs text-ink hover:bg-ivory-dark/70"
                >
                  Account settings
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="mt-1 w-full rounded-[4px] px-2 py-2 text-left text-xs text-ink hover:bg-ivory-dark/70 disabled:opacity-60"
                >
                  {signingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {(showIntel || showPortfolio) && (
          <div className="relative z-10 border-t-[0.5px] border-ivory-border bg-ivory">
            <div className="mx-auto flex max-w-[1536px] flex-wrap gap-1 px-4 py-2 sm:px-6 lg:px-8">
              {showIntel
                ? intelligenceSecondary.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.1em] transition-colors duration-200 ${
                          active ? "text-ink" : "text-ink-mid hover:text-ink"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })
                : null}
              {showPortfolio
                ? portfolioSecondary.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.1em] transition-colors duration-200 ${
                          active ? "text-ink" : "text-ink-mid hover:text-ink"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })
                : null}
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1536px] px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
