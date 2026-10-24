"use client";

import { PanelLeftClose } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { cn } from "../lib/utils";
import { StyleSync } from "./StyleSync";

const links = [
  { href: "/investigate", label: "Investigate" },
  { href: "/historical", label: "Cash chart (2U)" },
];

// Old Kestrel demo pages stay reachable by URL; their own sub-navigation shows only inside them.
const demoLinks = [
  { href: "/c/kestrel", label: "Cash forecast" },
  { href: "/c/kestrel/learning", label: "What we learned" },
  { href: "/c/kestrel/record", label: "Decision record" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const inDemo = pathname.startsWith("/c/");
  const companyId = inDemo ? pathname.split("/")[2] : "";
  // The agent canvas and the case workspace own the whole window and pin Original tokens, so they skip the shared header.
  if (pathname.startsWith("/investigate") || pathname.startsWith("/case/")) {
    return (
      <main id="main" className="min-h-dvh">
        {children}
      </main>
    );
  }
  const showNavigation = pathname !== "/";
  // The historical page is real 2U history, not the Kestrel demo company.
  const sidebarTitle = pathname.startsWith("/historical")
    ? "2U / historical"
    : inDemo
      ? "Demo company"
      : "Domino";
  const navLinks = inDemo
    ? [
        ...links,
        ...demoLinks.map((l) => ({ ...l, href: l.href.replace("/c/kestrel", `/c/${companyId}`) })),
      ]
    : links;
  return (
    <div className="min-h-screen">
      <Suspense fallback={null}>
        <StyleSync />
      </Suspense>
      <a
        href="#main"
        className="sr-only z-50 rounded bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-6 py-2 md:px-10">
        <Link
          href="/"
          aria-label="Domino home"
          className="flex min-h-11 items-center gap-3 rounded font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Image src="/domino-logo.svg" width={32} height={32} alt="" priority />
          <span className="text-xl">
            domino<span className="text-primary">.</span>
          </span>
        </Link>
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-4 text-sm text-muted-foreground">
          <span className="hidden md:inline">Public 2U case study</span>
          <Link
            href="/investigate"
            className="flex min-h-11 items-center gap-2 rounded px-2 font-medium text-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Investigate
          </Link>
        </div>
      </header>
      <div
        className={cn(
          "mx-auto max-w-[1600px]",
          showNavigation && "lg:grid lg:grid-cols-[224px_minmax(0,1fr)]",
        )}
      >
        {showNavigation ? (
          <aside className="border-b bg-muted/50 px-6 py-4 lg:min-h-[calc(100vh-80px)] lg:border-b-0 lg:border-r lg:px-5 lg:py-8">
            <div className="mb-3 flex items-center justify-between text-sm font-medium lg:mb-6">
              <span>{sidebarTitle}</span>
              <PanelLeftClose className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <nav aria-label="Main navigation" className="flex flex-wrap gap-1 lg:flex-col">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                    pathname === href && "bg-background font-medium text-primary",
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <p className="mt-10 hidden px-3 text-xs leading-5 text-muted-foreground lg:block">
              Your judgment comes first.
              <br />
              Domino never moves money.
            </p>
          </aside>
        ) : null}
        <main id="main" className={cn("min-w-0", showNavigation && "px-6 py-8 md:px-10 md:py-10")}>
          {children}
        </main>
      </div>
    </div>
  );
}
