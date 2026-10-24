"use client";

import { StyleSelector } from "@/components/StyleSelector";
import { StyleSync } from "@/components/StyleSync";
import { cn } from "@/lib/utils";
import { ArrowUpRight, CircleHelp, PanelLeftClose } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";

const links = [
  { href: "/c/kestrel", label: "Cash forecast" },
  { href: "/c/kestrel/learning", label: "What we learned" },
  { href: "/c/kestrel/record", label: "Decision record" },
  { href: "/historical", label: "Historical case (2U)" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const companyId =
    pathname.split("/")[1] === "c"
      ? pathname.split("/")[2]
      : (process.env.NEXT_PUBLIC_DEMO_COMPANY_ID ?? "kestrel");
  const showNavigation = pathname !== "/";
  // The historical page is real 2U history, not the Kestrel demo company.
  const sidebarTitle = pathname.startsWith("/historical")
    ? "2U / historical"
    : companyId === "kestrel"
      ? "Kestrel Data"
      : "Company workspace";
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
          <span className="hidden xl:inline">Plan cash needs before you act.</span>
          <StyleSelector />
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
              <span>{sidebarTitle}</span>
              <PanelLeftClose className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <nav aria-label="Main navigation" className="flex flex-wrap gap-1 lg:flex-col">
              {links.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href.replace("/c/kestrel", `/c/${companyId}`)}
                  aria-current={
                    pathname === href.replace("/c/kestrel", `/c/${companyId}`) ? "page" : undefined
                  }
                  className={cn(
                    "flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                    pathname === href.replace("/c/kestrel", `/c/${companyId}`) &&
                      "bg-background font-medium text-primary",
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
