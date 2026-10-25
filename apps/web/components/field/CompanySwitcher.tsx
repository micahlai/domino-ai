"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { DemoStateToggle } from "./DemoStateToggle";
import {
  OPERATING_COMPANIES,
  type OperatingSelection,
  isLegacyOperatingTimelinePath,
  operatingWorldId,
  replayChoice,
  selectOperating,
  selectedOperatingRecord,
  useOperatingSelection,
  useReplayChoices,
  useSelectedCompany,
} from "./company";
import { companyDisplay, menuKey } from "./header-text";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const fallbackLink = cn(
  "flex h-9 items-center rounded-md border border-input bg-card px-3 text-[13px] font-medium shadow-xs transition-colors hover:bg-accent max-sm:h-11",
  focusRing,
);

/** One company chooses the same reconstructed feed on every product page. The picker always
 * opens a company's prepared baseline; planted issues come from the Brain map, and older
 * scenario URLs still resolve. */
export function CompanySwitcher() {
  const pathname = usePathname() ?? "";
  if (pathname === "/case/2u" || pathname.startsWith("/case/2u/"))
    return (
      <Link href="/" className={fallbackLink}>
        2U historical case · Open operating demos
      </Link>
    );
  if (
    pathname === "/judge" ||
    pathname.startsWith("/judge/") ||
    pathname.startsWith("/playground") ||
    pathname.startsWith("/c/kestrel")
  )
    return (
      <Link href="/" className={fallbackLink}>
        Sandbox · Open operating demos
      </Link>
    );
  if (isLegacyOperatingTimelinePath(pathname))
    return (
      <Link href="/" className={fallbackLink}>
        Legacy operating demo · Open current demos
      </Link>
    );
  return CONVEX_URL ? <LivePicker /> : <Picker />;
}

function LivePicker() {
  const { selected, error, companies } = useSelectedCompany();
  useReplayChoices();
  const statusOf = companies
    ? (next: OperatingSelection): OperatingStatus =>
        selectedOperatingRecord(companies, next, replayChoice(next))?.started ? "ready" : "idle"
    : undefined;
  return (
    <>
      <DemoStateToggle />
      <Picker selectedName={selected?.name} error={error} statusOf={statusOf} />
    </>
  );
}

export type OperatingStatus = "ready" | "idle";

function Picker({
  selectedName,
  error,
  statusOf,
}: {
  selectedName?: string;
  error?: string | null;
  statusOf?: (selection: OperatingSelection) => OperatingStatus;
}) {
  const selection = useOperatingSelection();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const onTimeline = /^\/c\/(?:[^/]+|operating\/[^/]+\/[^/]+)\/timeline(\/|$)/.test(pathname);
  const onCase = pathname === "/case" || pathname.startsWith("/case/");
  const pick = (next: OperatingSelection) => {
    selectOperating(next);
    if (onCase) router.push("/");
    else if (onTimeline) router.push(`/c/${encodeURIComponent(operatingWorldId(next))}/timeline`);
  };
  return (
    <OperatingSelectorControls
      selection={selection}
      onChange={pick}
      selectedName={selectedName}
      error={error}
      statusOf={statusOf}
    />
  );
}

/** Props-only selector for the Field playground. No backend or financial fixture is needed.
 * One button names the company; it opens a menu of companies, each at its baseline. */
export function OperatingSelectorControls({
  selection,
  onChange,
  selectedName,
  error,
  statusOf,
  defaultOpen = false,
}: {
  selection: OperatingSelection;
  onChange: (selection: OperatingSelection) => void;
  selectedName?: string;
  error?: string | null;
  /** "Ready" (has data) or "Not started" per option; omitted without a backend. */
  statusOf?: (selection: OperatingSelection) => OperatingStatus;
  /** Render the menu open (tests and the playground). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const focusOnOpen = useRef<"selected" | "last">("selected");
  const menuId = useId();
  const company = OPERATING_COMPANIES.find((c) => c.id === selection.company);
  const shown = company ? companyDisplay(company) : null;
  const count = OPERATING_COMPANIES.length;

  useEffect(() => {
    if (!open) return;
    const start =
      focusOnOpen.current === "last"
        ? count - 1
        : Math.max(
            0,
            OPERATING_COMPANIES.findIndex((c) => c.id === selection.company),
          );
    items.current[start]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, count, selection.company]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };
  const choose = (next: OperatingSelection) => {
    close(true);
    if (next.company !== selection.company || next.scenario !== selection.scenario) onChange(next);
  };
  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    focusOnOpen.current = event.key === "ArrowUp" ? "last" : "selected";
    setOpen(true);
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.current.findIndex((el) => el === document.activeElement);
    const action = menuKey(event.key, index, count);
    if (!action) return;
    if (action.type === "move") {
      event.preventDefault();
      items.current[action.index]?.focus();
    } else {
      if (action.returnFocus) event.preventDefault();
      close(action.returnFocus);
    }
  };
  return (
    <div ref={root} className="relative flex items-center gap-2">
      {error ? (
        <span role="alert" className="max-w-40 text-xs leading-4 text-destructive max-sm:hidden">
          {error}
        </span>
      ) : null}
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={selectedName}
        onClick={() => {
          focusOnOpen.current = "selected";
          setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKey}
        className={cn(
          "flex h-10 items-center gap-2.5 rounded-md border border-input bg-card pl-1.5 pr-2 text-left shadow-xs transition-colors duration-150 hover:bg-accent max-sm:h-11",
          open && "bg-accent",
          focusRing,
        )}
      >
        <CompanyMark initial={shown?.initial ?? "?"} />
        <span className="flex flex-col whitespace-nowrap">
          <span className="sr-only">Company: </span>
          <span className="text-[13px] font-medium leading-4">
            {shown?.name ?? "Choose a demo"}
          </span>
          <span className="text-[11px] leading-4 text-muted-foreground">{shown?.subtitle}</span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-4 text-muted-foreground" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Company"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <MenuGroup label="Company">
            {OPERATING_COMPANIES.map((c, i) => {
              const d = companyDisplay(c);
              const checked = c.id === selection.company;
              return (
                <MenuItem
                  key={c.id}
                  ref={(el) => {
                    items.current[i] = el;
                  }}
                  checked={checked}
                  onSelect={() => choose({ company: c.id, scenario: "baseline" })}
                >
                  <CompanyMark initial={d.initial} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13px] font-medium leading-5">{d.name}</span>
                    <span className="text-xs leading-4 text-muted-foreground">{d.subtitle}</span>
                  </span>
                  <StatusTag status={statusOf?.({ company: c.id, scenario: "baseline" })} />
                </MenuItem>
              );
            })}
          </MenuGroup>
          <div className="-mx-1.5 mt-1.5 border-t px-3 pb-1 pt-2.5 text-xs leading-5 text-muted-foreground">
            Real 2U results after the filing are in the{" "}
            <Link
              href="/case/2u"
              onClick={() => setOpen(false)}
              className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              2U historical case
            </Link>
            .
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusTag({ status }: { status?: OperatingStatus }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-4",
        status === "ready"
          ? "bg-secondary text-foreground"
          : "border border-dashed border-input text-muted-foreground",
      )}
    >
      {status === "ready" ? "Ready" : "Not started"}
    </span>
  );
}

function CompanyMark({ initial }: { initial: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-[11px] font-semibold text-foreground"
    >
      {initial}
    </span>
  );
}

function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a menu groups items with role="group", not a fieldset.
    <div role="group" aria-labelledby={id}>
      <p id={id} className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function MenuItem({
  ref,
  checked,
  onSelect,
  children,
}: {
  ref: (el: HTMLButtonElement | null) => void;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      onClick={onSelect}
      className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-sm:min-h-11"
    >
      {children}
      <Check
        aria-hidden="true"
        className={cn("size-4 shrink-0 text-foreground", checked ? "opacity-100" : "opacity-0")}
      />
    </button>
  );
}
