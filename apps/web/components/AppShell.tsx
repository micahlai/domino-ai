"use client";

import { cn } from "@/lib/utils";
import { ArrowUpRight, CircleHelp, PanelLeftClose } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const links = [
  { href: "/c/kestrel", label: "Possible futures" },
  { href: "/c/kestrel/learning", label: "What we learned" },
  { href: "/c/kestrel/record", label: "Decision record" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showNavigation = pathname !== "/";
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="flex min-h-20 items-center justify-between gap-4 border-b px-6 md:px-10">
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
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="hidden sm:inline">See the chain. Change the outcome.</span>
          <Link
            href="/playground"
            className="flex min-h-11 items-center gap-2 rounded px-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Playground
            <ArrowUpRight className="size-4" aria-hidden="true" />
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
              <span>Kestrel Data</span>
              <PanelLeftClose className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <nav aria-label="Main navigation" className="flex flex-wrap gap-1 lg:flex-col">
              {links.map(({ href, label }) => (
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
              <div className="my-4 hidden border-t lg:block" />
              <Link
                href="/connect"
                aria-current={pathname === "/connect" ? "page" : undefined}
                className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <CircleHelp className="size-4" aria-hidden="true" />
                Connect a company
              </Link>
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
