"use client";

import { useMutation } from "convex/react";
import { Loader2, MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { errorText } from "../judge/shared";
import { Segmented } from "../ui/segmented";
import {
  type DemoKind,
  type DemoStateInfo,
  FIELD_OPERATING_API,
  type OperatingScenarioId,
  chooseReplay,
  demoCopyChoice,
  rememberDemoCopy,
  selectOperating,
  useOperatingSelection,
  useSelectedCompany,
} from "./company";

const OPTIONS = [
  { value: "fresh", label: "Fresh start" },
  { value: "upToDate", label: "Up to date" },
] as const;
/** Same bound as the backend: a build with no progress for this long has stopped. */
const BUILD_STALE_MS = 5 * 60_000;

/**
 * Header demo-state toggle for the selected company. "Fresh start" opens an idle copy with
 * nothing read; "Up to date" opens a copy whose agents have run over several simulated weeks
 * (built once, then reused). Both are new copies; this browser remembers which one it shows.
 */
export function DemoStateToggle() {
  const { selected, companies } = useSelectedCompany();
  const selection = useOperatingSelection();
  const openState = useMutation(FIELD_OPERATING_API.openDemoState);
  const [busy, setBusy] = useState<DemoKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!selected || !companies) return null;

  const show = (kind: DemoKind, companyId: string, scenario: OperatingScenarioId) => {
    rememberDemoCopy(selection.company, kind, companyId);
    const target = { company: selection.company, scenario };
    chooseReplay(target, companyId);
    if (scenario !== selection.scenario) selectOperating(target);
  };
  const go = async (kind: DemoKind, rebuild = false) => {
    setError(null);
    if (!rebuild) {
      const remembered = demoCopyChoice(selection.company, kind);
      const record = companies.find(
        (c) =>
          c.companyId === remembered &&
          c.demoState?.kind === kind &&
          c.demoState.status !== "failed",
      );
      if (record) return show(kind, record.companyId, record.scenario);
    }
    setBusy(kind);
    try {
      const next = await openState({ companyId: selected.companyId, kind, rebuild });
      show(kind, next.companyId, next.scenario);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-1.5 max-lg:hidden">
      <BuildStatus state={selected.demoState ?? null} busy={busy} error={error} />
      <Segmented<DemoKind | "none">
        label="Demo state"
        name="domino-demo-state"
        options={OPTIONS}
        value={selected.demoState?.kind ?? "none"}
        onChange={(kind) => {
          if (kind !== "none" && !busy) void go(kind);
        }}
      />
      <DemoMenu disabled={busy !== null} onPick={(kind) => void go(kind, true)} />
    </div>
  );
}

function BuildStatus({
  state,
  busy,
  error,
}: {
  state: DemoStateInfo | null;
  busy: DemoKind | null;
  error: string | null;
}) {
  const note = (text: string, tone: "muted" | "error" = "muted", spin = false) => (
    <span
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex max-w-[16rem] items-center gap-1 truncate text-xs leading-4",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      title={text}
    >
      {spin ? <Loader2 aria-hidden="true" className="size-3 shrink-0 animate-spin" /> : null}
      <span className="truncate">{text}</span>
    </span>
  );
  if (error) return note(error, "error");
  if (busy) return note("Opening…", "muted", true);
  if (state?.kind !== "upToDate") return null;
  if (state.status === "failed")
    return note(
      `Up-to-date view stopped: ${state.error ?? "unknown error"}. Use Rebuild.`,
      "error",
    );
  if (state.status !== "building") return null;
  if (Date.now() - Date.parse(state.updatedAt) > BUILD_STALE_MS)
    return note("Up-to-date view stopped. Use Rebuild to try again.", "error");
  const week = Math.min(state.week + 1, state.weeks);
  return (
    <output
      aria-live="polite"
      className="flex items-center gap-1 whitespace-nowrap text-xs leading-4 text-muted-foreground"
    >
      <Loader2 aria-hidden="true" className="size-3 shrink-0 animate-spin" />
      <span className="hidden xl:inline">Preparing up-to-date view… </span>
      <span>
        (week {week} of {state.weeks})
      </span>
    </output>
  );
}

function DemoMenu({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (kind: DemoKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const pick = (kind: DemoKind) => {
    setOpen(false);
    trigger.current?.focus();
    onPick(kind);
  };
  const item =
    "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent";
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label="Demo state options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
          open && "bg-accent text-foreground",
        )}
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Demo state options"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <button
            ref={first}
            type="button"
            role="menuitem"
            className={item}
            onClick={() => pick("upToDate")}
          >
            <span className="text-[13px] font-medium leading-5">Rebuild up-to-date view</span>
            <span className="text-xs leading-4 text-muted-foreground">
              A new copy, played forward 8 simulated weeks
            </span>
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => pick("fresh")}>
            <span className="text-[13px] font-medium leading-5">New fresh start</span>
            <span className="text-xs leading-4 text-muted-foreground">
              A new copy with nothing read yet
            </span>
          </button>
          <p className="px-2 pb-1 pt-1.5 text-xs leading-4 text-muted-foreground">
            Existing copies are kept as they are.
          </p>
        </div>
      ) : null}
    </div>
  );
}
