"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { cn } from "../lib/utils";
import { StyleSync } from "./StyleSync";

// Top-level pages of the weekly product, in reading order.
const SIMULATIONS = /^\/(simulations|c\/[^/]+\/simulations)(\/|$)/;
const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);
const primaryLinks = [
  { href: "/", label: "Dashboard", on: (p: string) => p === "/" },
  {
    href: "/field",
    label: "Worker",
    on: (p: string) => under(p, "/field") && !under(p, "/field/map"),
  },
  { href: "/field/map", label: "Brain map", on: (p: string) => under(p, "/field/map") },
  {
    href: "/c/kestrel",
    label: "Timeline",
    on: (p: string) => under(p, "/c") && !SIMULATIONS.test(p),
  },
  { href: "/simulations", label: "Simulations", on: (p: string) => SIMULATIONS.test(p) },
];

// The old Kestrel demo pages keep their sub-navigation inside the Timeline routes.
const demoLinks = [
  { href: "/c/kestrel", label: "Cash forecast" },
  { href: "/c/kestrel/learning", label: "What we learned" },
  { href: "/c/kestrel/record", label: "Decision record" },
];

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

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
  const demoNav = demoLinks.map((l) => ({
    ...l,
    href: l.href.replace("/c/kestrel", `/c/${companyId}`),
  }));
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
      {/* On small screens the page links drop to their own scrollable row under the logo. */}
      <header className="flex flex-wrap items-center gap-x-6 border-b px-4 md:min-h-16 md:flex-nowrap md:px-10">
        <Link
          href="/"
          aria-label="Domino home"
          className={cn(
            "flex min-h-14 shrink-0 items-center gap-2.5 rounded font-semibold tracking-tight",
            focusRing,
          )}
        >
          <Image src="/domino-logo.svg" width={28} height={28} alt="" priority />
          <span className="text-lg">
            domino<span className="text-primary">.</span>
          </span>
        </Link>
        <nav
          aria-label="Main navigation"
          className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto border-t px-4 md:order-none md:mx-0 md:w-auto md:flex-1 md:border-t-0 md:px-0"
        >
          <ul className="flex gap-1 py-2 md:py-0">
            {primaryLinks.map(({ href, label, on }) => {
              const active = on(pathname);
              return (
                <li key={href} className="shrink-0">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      focusRing,
                      active && "bg-muted font-medium text-foreground",
                    )}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <Link
          href="/case"
          aria-current={pathname === "/case" ? "page" : undefined}
          className={cn(
            "ml-auto flex min-h-11 shrink-0 items-center rounded px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
            focusRing,
          )}
        >
          2U case study
        </Link>
      </header>
      <div
        className={cn(
          "mx-auto max-w-[1600px]",
          inDemo && "lg:grid lg:grid-cols-[224px_minmax(0,1fr)]",
        )}
      >
        {inDemo ? (
          <aside className="border-b bg-muted/50 px-4 py-3 md:px-10 lg:min-h-[calc(100vh-64px)] lg:border-b-0 lg:border-r lg:px-5 lg:py-8">
            <p className="mb-2 hidden px-3 text-sm font-medium lg:block">Demo company</p>
            <nav aria-label="Timeline pages" className="flex flex-wrap gap-1 lg:flex-col">
              {demoNav.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cn(
                    "flex min-h-10 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
                    focusRing,
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
        <main id="main" className="min-w-0 px-4 py-8 md:px-10 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
