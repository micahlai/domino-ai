import { AppShell } from "@/components/AppShell";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
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
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="font-sans">
        <ConvexClientProvider>
          <AppShell>{children}</AppShell>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
