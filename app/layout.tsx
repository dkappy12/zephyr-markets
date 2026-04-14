import type { Metadata } from "next";
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
      <body className="min-h-full bg-ivory font-sans text-ink">{children}</body>
    </html>
  );
}
