"use client";

import { TopoBackground } from "@/components/ui/TopoBackground";
import Link from "next/link";
import { usePathname } from "next/navigation";

const primary = [
  { href: "/dashboard/overview", label: "Overview" },
  { href: "/dashboard/intelligence/signals", label: "Intelligence" },
  { href: "/dashboard/portfolio/book", label: "Portfolio" },
  { href: "/dashboard/brief", label: "Brief" },
  { href: "/dashboard/settings", label: "Settings" },
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

export function DashboardChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showIntel = sectionActive(pathname, "/dashboard/intelligence");
  const showPortfolio = sectionActive(pathname, "/dashboard/portfolio");

  return (
    <div className="min-h-screen bg-ivory">
      <header className="sticky top-0 z-40 border-b-[0.5px] border-ivory-border bg-ivory/95 backdrop-blur-[2px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-14 overflow-hidden">
          <TopoBackground className="h-full w-full" lineOpacity={0.25} />
        </div>
        <div className="relative z-10 mx-auto flex h-14 max-w-[1536px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/dashboard/overview"
            className="shrink-0 font-serif text-xl tracking-tight text-ink"
          >
            Zephyr
          </Link>
          <nav
            className="-mx-1 flex flex-1 items-center justify-start gap-0.5 overflow-x-auto px-1 md:justify-center"
            aria-label="Primary"
          >
            {primary.map((item) => {
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
          <div className="flex shrink-0 items-center gap-3">
            <span
              className="flex size-9 items-center justify-center rounded-full border-[0.5px] border-ivory-border bg-card font-serif text-sm text-ink"
              aria-hidden
            >
              DK
            </span>
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
