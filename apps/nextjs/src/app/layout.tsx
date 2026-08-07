import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";

import { cn } from "@acme/ui";

import { env } from "~/env";

import "~/app/styles.css";

const productionUrl = "https://app.nimbase.ai";

export const metadata: Metadata = {
  metadataBase: new URL(
    env.VERCEL_ENV === "production" ? productionUrl : "http://localhost:3100",
  ),
  title: "Nimbase — CLI-first company memory",
  description:
    "The secure memory layer that gives employees, customers, apps, and agents the company context they're allowed to know.",
  openGraph: {
    title: "Nimbase",
    description:
      "The secure memory layer that gives employees, customers, apps, and agents the company context they're allowed to know.",
    url: productionUrl,
    siteName: "Nimbase",
  },
  twitter: {
    card: "summary_large_image",
    site: "@jullerino",
    creator: "@jullerino",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

// Nimbase brand type — one geometric sans (Plus Jakarta Sans, a
// Circular/Airwallex-style face) for body + display, IBM Plex Mono for
// technical strings. Variable names stay `--font-app-*` so theme.css maps
// them to `--font-sans` / `--font-mono` unchanged.
const sans = Plus_Jakarta_Sans({
  subsets: ["latin", "vietnamese"],
  variable: "--font-app-sans",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-app-mono",
});

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          sans.variable,
          mono.variable,
        )}
      >
        {props.children}
      </body>
    </html>
  );
}
