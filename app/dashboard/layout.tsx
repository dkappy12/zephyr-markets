import {
  DashboardChrome,
  type DashboardInitialAuth,
} from "@/components/dashboard/DashboardChrome";
import { ThemeProvider } from "@/context/ThemeContext";
import { createClient } from "@/lib/supabase/server";
import { initialsFromUser } from "@/lib/team/user-initials";
import Script from "next/script";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let initialAuth: DashboardInitialAuth | null = null;
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const appRole = String(
          (user.app_metadata as { role?: string } | undefined)?.role ?? "",
        )
          .trim()
          .toLowerCase();
        initialAuth = {
          email: user.email ?? null,
          initials: initialsFromUser(user),
          isAppAdmin: appRole === "admin",
        };
      }
    } catch {
      // Client chrome will still hydrate from the browser session.
    }
  }

  return (
    <ThemeProvider>
      <Script
        id="theme-init"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var saved = localStorage.getItem('zephyr-theme');
                if (saved === 'dark') {
                  document.documentElement.setAttribute('data-theme', 'dark');
                } else if (saved === 'light') {
                  document.documentElement.setAttribute('data-theme', 'light');
                } else {
                  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                    document.documentElement.setAttribute('data-theme', 'dark');
                  }
                }
              } catch(e) {}
            })();
          `,
        }}
      />
      <DashboardChrome initialAuth={initialAuth}>{children}</DashboardChrome>
    </ThemeProvider>
  );
}
