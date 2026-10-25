"use client";

import { operatingProvenance } from "@domino/sim";
import { useState } from "react";
import { IconGallery } from "../icons/IconGallery";
import { BrainMap } from "./BrainMap";
import { OperatingSelectorControls } from "./CompanySwitcher";
import { ConnectView } from "./ConnectPage";
import { OperatingProvenanceStrip, SourceContents } from "./OperatingProvenanceStrip";
import { type ClockState, SimClockView } from "./SimClockBar";
import { WorkerPage } from "./WorkerPage";
import { DEFAULT_OPERATING_SELECTION, type OperatingSelection } from "./company";
import { DemoConnectData } from "./connect-data";
import { DemoFieldData } from "./data";

/**
 * Both Field pages on demo data, always: the playground never reads or writes the backend.
 * They share one demo store, so a button pressed in one shows up in the other.
 */
export function FieldPlayground() {
  const [selection, setSelection] = useState<OperatingSelection>(DEFAULT_OPERATING_SELECTION);
  return (
    <DemoFieldData note="Playground fixture">
      <div className="space-y-16">
        <section id="OperatingSelection" className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Filing-backed operating demo controls</h2>
          <OperatingSelectorControls selection={selection} onChange={setSelection} />
          <PlaygroundContextRow />
          <p className="text-xs text-muted-foreground">
            Scenario: {selection.scenario}. This playground selector changes no backend feed.
          </p>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-primary">
              Preview reported anchors and reconstruction basis
            </summary>
            <div className="mt-3 max-w-xl text-xs">
              <SourceContents context={operatingProvenance(selection)} />
            </div>
          </details>
        </section>
        <section id="WorkerPage" className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Worker page (/field)</h2>
          <WorkerPage />
        </section>
        <section id="BrainMap" className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Brain map (/field/map)</h2>
          <BrainMap />
        </section>
        <section id="Icons" className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Icons (components/icons)</h2>
          <IconGallery />
        </section>
        <section id="ConnectPage" className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Connected tools (/field/connect)
          </h2>
          <DemoConnectData note="Playground fixture">
            <ConnectView />
          </DemoConnectData>
        </section>
      </div>
    </DemoFieldData>
  );
}

/** The page context row (provenance plus simulated time) on local state only. */
function PlaygroundContextRow() {
  const [clock, setClock] = useState<ClockState>({
    date: "2026-10-27",
    day: 3,
    speed: 1,
    status: "paused",
    ticking: false,
    pausedReason: null,
    nextEvent: { day: 9, inDays: 6, title: "Largest customer pays late" },
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b pb-3">
      <OperatingProvenanceStrip />
      <SimClockView
        clock={clock}
        error={null}
        onToggle={() =>
          setClock((c) => ({ ...c, status: c.status === "playing" ? "paused" : "playing" }))
        }
        onSpeed={(speed) => setClock((c) => ({ ...c, speed }))}
        onJump={() =>
          setClock((c) => ({
            ...c,
            day: 8,
            nextEvent: c.nextEvent ? { ...c.nextEvent, inDays: 1 } : null,
          }))
        }
      />
    </div>
  );
}
