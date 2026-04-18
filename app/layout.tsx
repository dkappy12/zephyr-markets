import type { Metadata } from "next";
import { ThemeProvider } from "@/context/ThemeContext";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Zephyr Markets",
    template: "%s · Zephyr Markets",
  },
  description:
    "Real-time physical intelligence for GB and Northwest European energy traders. The physical world, translated into financial intelligence.",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png" }],
  },
  metadataBase: new URL("https://zephyr.markets"),
  openGraph: {
    title: "Zephyr Markets",
    description:
      "Real-time physical intelligence for GB power and European gas traders. Live REMIT signals, a CCGT-anchored premium score, and a 06:00 brief sized to your book.",
    url: "https://zephyr.markets",
    siteName: "Zephyr Markets",
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    description:
      "Real-time physical intelligence for GB power and European gas traders. Live REMIT signals, a CCGT-anchored premium score, and a 06:00 brief sized to your book.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <script
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
      <body className="min-h-full bg-ivory font-sans text-ink">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
