"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  OPERATING_COMPANIES,
  OPERATING_SCENARIOS,
  type OperatingCompanyId,
  type OperatingScenarioId,
  type OperatingSelection,
  isLegacyOperatingTimelinePath,
  operatingWorldId,
  selectOperating,
  useOperatingSelection,
  useSelectedCompany,
} from "./company";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/** One company and one scenario choose the same reconstructed feed on every product page. */
export function CompanySwitcher() {
  const pathname = usePathname() ?? "";
  if (pathname === "/case/2u" || pathname.startsWith("/case/2u/"))
    return (
      <Link href="/" className="rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent">
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
      <Link href="/" className="rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent">
        Sandbox · Open operating demos
      </Link>
    );
  if (isLegacyOperatingTimelinePath(pathname))
    return (
      <Link href="/" className="rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent">
        Legacy operating demo · Open current demos
      </Link>
    );
  return CONVEX_URL ? <LivePicker /> : <Picker />;
}

function LivePicker() {
  const { selected, error } = useSelectedCompany();
  return <Picker selectedName={selected?.name} error={error} />;
}

function Picker({ selectedName, error }: { selectedName?: string; error?: string | null }) {
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
    />
  );
}

/** Props-only selector for the Field playground. No backend or financial fixture is needed. */
export function OperatingSelectorControls({
  selection,
  onChange,
  selectedName,
  error,
}: {
  selection: OperatingSelection;
  onChange: (selection: OperatingSelection) => void;
  selectedName?: string;
  error?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Operating demo selection">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="sr-only sm:not-sr-only">Company</span>
        <select
          aria-label="Company"
          value={selection.company}
          onChange={(event) =>
            onChange({ ...selection, company: event.target.value as OperatingCompanyId })
          }
          className="h-9 max-w-[11rem] rounded-md border bg-card px-2 text-sm font-medium text-foreground sm:max-w-[14rem]"
          title={selectedName ?? "Choose a filing-backed demo"}
        >
          {OPERATING_COMPANIES.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="sr-only sm:not-sr-only">Scenario</span>
        <select
          aria-label="Scenario"
          value={selection.scenario}
          onChange={(event) =>
            onChange({ ...selection, scenario: event.target.value as OperatingScenarioId })
          }
          className="h-9 max-w-[10rem] rounded-md border bg-card px-2 text-sm font-medium text-foreground sm:max-w-[12rem]"
        >
          {OPERATING_SCENARIOS.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.name}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <span role="alert" className="max-w-48 text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
