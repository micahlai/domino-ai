"use client";

import type { ProfileId } from "@domino/sim";
import { useMutation } from "convex/react";
import { Check, ChevronsUpDown, Landmark } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { cn } from "../../lib/utils";
import { FIELD_COMPANIES, selectCompany, useSelectedCompany, useSelectedProfile } from "./company";

// Top bar company picker: the four simulated companies (each a live feed in the backend) and
// the real 2U case study. Picking one switches the dashboard, worker, brain map and connect
// pages to it. Without a backend the demo data follows the same choice.

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
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const selected = items.find((i) => i.profile === current);
  const name = selected?.name ?? "Choose a company";
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          onOpen?.();
        }}
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border bg-card pl-1.5 pr-2 text-[13px] font-medium shadow-xs transition-colors hover:bg-accent",
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded bg-primary text-[11px] font-semibold text-primary-foreground"
        >
          {name.charAt(0)}
        </span>
        <span className="hidden sm:inline">{name}</span>
        <span className="sr-only sm:hidden">Company: {name}</span>
        {selected ? <HealthDot health={selected.health} /> : null}
        <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Companies"
          className="absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Simulated companies{demo ? " (demo data)" : ""}
          </p>
          <ul className="px-1.5 pb-1.5">
            {items.map((item) => {
              const on = item.profile === current;
              return (
                <li key={item.profile}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    onClick={() => {
                      selectCompany(item.profile);
                      setOpen(false);
                      button.current?.focus();
                    }}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
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
          <div className="border-t px-1.5 py-1.5">
            <Link
              href="/case/2u"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent",
                focusRing,
              )}
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border bg-card"
              >
                <Landmark className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">2U (real story)</span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  Real company, quarterly public filings
                </span>
              </span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
