import { DashboardChrome } from "@/components/dashboard/DashboardChrome";
import { ThemeProvider } from "@/context/ThemeContext";
import Script from "next/script";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <DashboardChrome>{children}</DashboardChrome>
    </ThemeProvider>
  );
}
