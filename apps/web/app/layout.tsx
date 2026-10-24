import { AppShell } from "@/components/AppShell";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { styleInitScript } from "@/lib/style";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "Domino — See what comes next", template: "%s · Domino" },
  description: "See which cash problems could start a chain reaction. Try fixes before you decide.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-style is set by the inline script before paint, so React must not reset it on hydrate.
    <html
      lang="en"
      className={`${inter.variable} dark`}
      data-style="original"
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant script built from the style registry; no user input reaches it */}
        <script dangerouslySetInnerHTML={{ __html: styleInitScript }} />
      </head>
      <body className="font-sans">
        <ConvexClientProvider>
          <AppShell>{children}</AppShell>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
