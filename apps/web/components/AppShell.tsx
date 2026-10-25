"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { cn } from "../lib/utils";
import { StyleSync } from "./StyleSync";
import { CompanySwitcher } from "./field/CompanySwitcher";
import { NotificationToasts } from "./field/NotificationToasts";
import { OperatingProvenanceStrip } from "./field/OperatingProvenanceStrip";
import { SimClockBar } from "./field/SimClockBar";
import {
  isPrimaryOperatingTimelinePath,
  operatingWorldId,
  useOperatingSelection,
} from "./field/company";

// Top-level pages of the weekly product, in reading order. Dev routes (/playground, the seam
// harnesses, /investigate, /historical) stay reachable by URL but are never listed here. The 2U
// case study opens from the company switcher.
const SIMULATIONS = /^\/(simulations|c\/[^/]+\/simulations)(\/|$)/;
/** Timeline's own routes (TL7): /c/<company>/timeline and its analysis page. */
const TIMELINE = /^\/c\/(?:[^/]+|operating\/[^/]+\/[^/]+)\/timeline(\/|$)/;
const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);
/** The Timeline link follows the company picked in the top bar. */
const primaryLinks = (profile: string) => [
  { href: "/", label: "Dashboard", on: (p: string) => p === "/" },
  {
    href: "/field",
    label: "Worker",
    on: (p: string) => under(p, "/field") && !under(p, "/field/map") && !under(p, "/field/connect"),
  },
  { href: "/field/map", label: "Brain map", on: (p: string) => under(p, "/field/map") },
  {
    href: "/field/connect",
    label: "Connected tools",
    on: (p: string) => under(p, "/field/connect"),
  },
  {
    href: `/c/${profile}/timeline`,
    label: "Timeline",
    on: (p: string) => under(p, "/c") && !SIMULATIONS.test(p),
  },
  { href: "/simulations", label: "Simulations", on: (p: string) => SIMULATIONS.test(p) },
  // Judge sandbox: a fresh simulated company to try scenarios on.
  { href: "/judge", label: "Try it", on: (p: string) => under(p, "/judge") },
];

/** Routes that own the whole window under the top bar and pin the Original dark tokens. */
export const isFullWindow = (p: string) => under(p, "/investigate") || under(p, "/case/2u");
const isOperatingProduct = (p: string) =>
  p === "/" || under(p, "/field") || under(p, "/simulations") || isPrimaryOperatingTimelinePath(p);

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
  const timelineWorkspace = /^\/c\/[^/]+\/timeline\/?$/.test(pathname);
  // The older demo sub-navigation stays on the legacy /c pages; Timeline pages have their own.
  const inDemo = pathname.startsWith("/c/") && !TIMELINE.test(pathname);
  const companyId = inDemo ? (pathname.split("/")[2] ?? "") : "";
  const demoNav = demoLinks.map((l) => ({
    ...l,
    href: l.href.replace("/c/kestrel", `/c/${companyId}`),
  }));
  // The agent canvas and the case workspace keep the same top bar, then fill the rest of the
  // window with their own (dark) layout.
  if (isFullWindow(pathname) || timelineWorkspace) {
    return (
      <div className="flex h-dvh flex-col">
        <TopBar pathname={pathname} />
        {timelineWorkspace && isOperatingProduct(pathname) ? (
          // The filled Timeline keeps Field's exact source label and simulated clock.
          <div className="shrink-0 px-3 pt-2 sm:px-4 [&>div]:mb-0 [&>div]:pb-2 md:[&>div]:mb-0">
            <PageContext pathname={pathname} />
          </div>
        ) : null}
        <main
          id="main"
          className={cn("min-h-0 flex-1", timelineWorkspace && "min-w-0 overflow-auto")}
        >
          {children}
        </main>
        <Notifications />
      </div>
    );
  }
  return (
    <div className="min-h-screen">
      <TopBar pathname={pathname} />
      <div
        className={cn(
          "mx-auto max-w-[1600px]",
          inDemo && "lg:grid lg:grid-cols-[216px_minmax(0,1fr)]",
        )}
      >
        {inDemo ? (
          <aside className="border-b px-4 py-3 md:px-6 lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
            <p className="mb-2 hidden px-2.5 text-xs font-medium text-muted-foreground lg:block">
              Demo company
            </p>
            <nav aria-label="Timeline pages" className="flex flex-wrap gap-1 lg:flex-col">
              {demoNav.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
                    focusRing,
                    pathname === href && "bg-secondary font-medium text-foreground",
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <p className="mt-8 hidden px-2.5 text-xs leading-5 text-muted-foreground lg:block">
              Your judgment comes first.
              <br />
              Domino never moves money.
            </p>
          </aside>
        ) : null}
        <main id="main" className="min-w-0 px-4 py-6 md:px-8 md:py-8">
          {isOperatingProduct(pathname) && !isRecordedPath(pathname) ? (
            <PageContext pathname={pathname} />
          ) : null}
          {children}
        </main>
      </div>
      <Notifications />
    </div>
  );
}

/** One toast stack for the whole app; it needs the backend to read events. */
const Notifications = () => (process.env.NEXT_PUBLIC_CONVEX_URL ? <NotificationToasts /> : null);

/** Saved trace and calculation pages show a recorded run, not the live feed. */
const isRecordedPath = (pathname: string) =>
  pathname === "/field/analysis" ||
  pathname.startsWith("/field/analysis/") ||
  (TIMELINE.test(pathname) && pathname.replace(/\/$/, "").endsWith("/calculation"));

/** One row above the page title: where the books come from, then simulated time on the pages
 * that move with the clock. Wraps to two rows on phones. */
function PageContext({ pathname }: { pathname: string }) {
  return (
    <div className="mb-5 flex min-h-9 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b pb-3 md:mb-6">
      <OperatingProvenanceStrip />
      <SimClockBar pathname={pathname} />
    </div>
  );
}

/** Logo, page links, then the company switcher. On small screens the page links drop to their
 * own scrollable row under the logo. Always the light style, even above the dark pages. */
function TopBar({ pathname }: { pathname: string }) {
  if (isRecordedPath(pathname)) {
    const timelineCompany = TIMELINE.test(pathname)
      ? (pathname.match(/^\/c\/(.+)\/timeline\/calculation\/?$/)?.[1] ??
        "operating%2F2u%2Fbaseline")
      : "operating%2F2u%2Fbaseline";
    return <TopBarContent pathname={pathname} timelineCompany={timelineCompany} recorded />;
  }
  return <LiveTopBar pathname={pathname} />;
}

function LiveTopBar({ pathname }: { pathname: string }) {
  const selection = useOperatingSelection();
  const timelineCompany = encodeURIComponent(operatingWorldId(selection));
  return <TopBarContent pathname={pathname} timelineCompany={timelineCompany} recorded={false} />;
}

function TopBarContent({
  pathname,
  timelineCompany,
  recorded,
}: {
  pathname: string;
  timelineCompany: string;
  recorded: boolean;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <StyleSync />
      </Suspense>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 shrink-0 border-b bg-card/95 text-foreground backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 px-4 md:h-14 md:flex-nowrap md:px-6">
          <Link
            href="/"
            aria-label="Domino home"
            className={cn(
              "flex h-14 shrink-0 items-center gap-2 rounded-md text-[15px] font-semibold tracking-[-0.01em]",
              focusRing,
            )}
          >
            <Image src="/domino-logo.svg" width={24} height={24} alt="" priority />
            <span>domino</span>
          </Link>
          <nav
            aria-label="Main navigation"
            className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto border-t px-2 md:order-none md:mx-0 md:h-full md:w-auto md:flex-1 md:border-t-0 md:px-0"
          >
            <ul className="flex h-11 gap-1 md:h-full">
              {primaryLinks(timelineCompany).map(({ href, label, on }) => {
                const active = on(pathname);
                return (
                  <li key={href} className="flex shrink-0">
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center px-2.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground",
                        // A 2px bar on the header's bottom hairline marks the current page.
                        "after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors",
                        focusRing,
                        "focus-visible:outline-offset-[-2px]",
                        active && "font-medium text-foreground after:bg-foreground",
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ml-auto flex shrink-0 items-center">
            {recorded ? (
              <span className="text-[13px] text-muted-foreground">Recorded run</span>
            ) : (
              <CompanySwitcher />
            )}
          </div>
        </div>
      </header>
    </>
  );
}
