"use client";

import type { ProfileId } from "@domino/sim";
import { useMutation } from "convex/react";
import { Check, ChevronsUpDown, Landmark } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { cn } from "../../lib/utils";
import {
  FIELD_COMPANIES,
  REPLAY_COMPANY,
  selectCompany,
  useIsReplayCompany,
  useSelectedCompany,
  useSelectedProfile,
} from "./company";

// Top bar company picker: the four simulated companies (each a live feed in the backend) and
// the real company 2U, replayed from its quarterly public filings. Picking one switches the
// dashboard, worker, brain map and connect pages to it. Without a backend the demo data follows
// the same choice. Picking 2U opens the dashboard in its quarterly rewind; the older 2U case
// study pages (/case/2u) stay reachable by URL, and picking a company there opens the dashboard.

type Rating = "ok" | "watch" | "at_risk";
type Item = {
  profile: ProfileId;
  name: string;
  story: string;
  /** undefined: not known yet (no backend health, or the first ingest has not run). */
  health?: { rating: Rating; week: string | null } | null;
};

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

const HEALTH: Record<Rating, { label: string; dot: string }> = {
  ok: { label: "On track", dot: "bg-safe" },
  watch: { label: "Watch", dot: "bg-warning" },
  at_risk: { label: "At risk", dot: "bg-destructive" },
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function healthText(health: Item["health"]) {
  if (!health) return "Waiting for the first read";
  const { label } = HEALTH[health.rating];
  return health.rating === "at_risk" && health.week
    ? `${label}: breaks the week of ${shortDate(health.week)}`
    : label;
}

function HealthDot({ health }: { health: Item["health"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        health ? HEALTH[health.rating].dot : "bg-muted-foreground/40",
      )}
    />
  );
}

const menuItems = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);

export function CompanySwitcher() {
  return CONVEX_URL ? <LiveSwitcher /> : <DemoSwitcher />;
}

function LiveSwitcher() {
  const { companies, selected } = useSelectedCompany();
  const setupAll = useMutation(api.field.setupAll);
  const asked = useRef(false);
  // Lazy setup: the first visit creates any picker company that does not exist yet.
  useEffect(() => {
    if (!companies || asked.current || companies.length >= FIELD_COMPANIES.length) return;
    asked.current = true;
    setupAll({}).catch(() => {
      asked.current = false;
    });
  }, [companies, setupAll]);
  const items: Item[] = FIELD_COMPANIES.map((c) => {
    const live = companies?.find((x) => x.profile === c.id);
    return { profile: c.id, name: c.name, story: c.story, health: live?.health ?? null };
  });
  const profile = selected?.profile ?? (selected === undefined ? undefined : null);
  return <Picker items={items} current={profile ?? undefined} />;
}

function DemoSwitcher() {
  const current = useSelectedProfile();
  const [health, setHealth] = useState<Partial<Record<ProfileId, Item["health"]>>>({});
  const loading = useRef(false);
  // Demo health comes from the same engine derivation as the demo dashboard. It loads on first
  // open, in its own chunk, so the shell does not carry the engine on every page.
  const load = () => {
    if (loading.current) return;
    loading.current = true;
    void import("./dashboard/data").then(({ buildDemo }) => {
      const out: Partial<Record<ProfileId, Item["health"]>> = {};
      for (const c of FIELD_COMPANIES) {
        const r = buildDemo(c.id).result;
        out[c.id] = r.ok ? { rating: r.view.health.rating, week: r.view.health.week } : null;
      }
      setHealth(out);
    });
  };
  const items: Item[] = FIELD_COMPANIES.map((c) => ({
    profile: c.id,
    name: c.name,
    story: c.story,
    health: health[c.id],
  }));
  return <Picker items={items} current={current} onOpen={load} demo />;
}

function Picker({
  items,
  current,
  onOpen,
  demo = false,
}: {
  items: Item[];
  current: ProfileId | undefined;
  onOpen?: () => void;
  demo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const onCase = pathname === "/case" || pathname.startsWith("/case/");
  const twoU = useIsReplayCompany() || onCase;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  /** Which item gets focus when the menu opens: the selected one, or the first/last by arrow. */
  const start = useRef<"selected" | "first" | "last">("selected");
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const items = menuItems(menu.current);
    const target =
      start.current === "first"
        ? items[0]
        : start.current === "last"
          ? items.at(-1)
          : (items.find((i) => i.getAttribute("aria-checked") === "true") ?? items[0]);
    target?.focus();
    const outside = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const openWith = (from: typeof start.current) => {
    start.current = from;
    setOpen(true);
    onOpen?.();
  };
  // Menu keys (WAI-ARIA menu pattern): arrows move, Home/End jump, Enter/Space activate (native
  // buttons and links), Escape closes and returns focus to the button, Tab closes.
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menu.current);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close(false);
  };
  const selected = twoU ? undefined : items.find((i) => i.profile === current);
  const name = twoU ? "2U, Inc." : (selected?.name ?? "Choose a company");
  const pick = (choice: typeof REPLAY_COMPANY | ProfileId) => {
    selectCompany(choice);
    setOpen(false);
    if (onCase) router.push("/");
    else button.current?.focus();
  };
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openWith("selected"))}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          openWith(e.key === "ArrowDown" ? "selected" : "last");
        }}
        className={cn(
          "flex h-11 items-center sm:h-9 gap-2 rounded-md border bg-card pl-1.5 pr-2 text-[13px] font-medium shadow-xs transition-colors hover:bg-accent",
          focusRing,
        )}
      >
        {twoU ? (
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded border bg-card"
          >
            <Landmark className="size-3.5" />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded bg-primary text-[11px] font-semibold text-primary-foreground"
          >
            {name.charAt(0)}
          </span>
        )}
        <span className="hidden sm:inline">{name}</span>
        <span className="sr-only sm:hidden">Company: {name}</span>
        {selected ? <HealthDot health={selected.health} /> : null}
        <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label="Companies"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Simulated companies{demo ? " (demo data)" : ""}
          </p>
          <ul className="px-1.5 pb-1.5">
            {items.map((item) => {
              const on = !twoU && item.profile === current;
              return (
                <li key={item.profile}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    tabIndex={-1}
                    onClick={() => pick(item.profile)}
                    className={cn(
                      "flex min-h-11 w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus:bg-accent focus:outline-none",
                      focusRing,
                      on && "bg-secondary",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-primary text-[11px] font-semibold text-primary-foreground"
                    >
                      {item.name.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[13px] font-medium">
                        {item.name}
                        {on ? <Check className="size-3.5" aria-label="selected" /> : null}
                      </span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        {item.story}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <HealthDot health={item.health} />
                        {healthText(item.health)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Real company
          </p>
          <div className="px-1.5 pb-1.5">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={twoU}
              tabIndex={-1}
              onClick={() => pick(REPLAY_COMPANY)}
              className={cn(
                "flex min-h-11 w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus:bg-accent focus:outline-none",
                focusRing,
                twoU && "bg-secondary",
              )}
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border bg-card"
              >
                <Landmark className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  2U, Inc.
                  {twoU ? <Check className="size-3.5" aria-label="selected" /> : null}
                </span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  Quarterly public filings, rewound to Nov 10, 2023
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Replay: what happened next stays hidden until you reveal it
                </span>
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
