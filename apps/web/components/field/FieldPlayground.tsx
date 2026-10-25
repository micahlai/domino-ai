"use client";

import { operatingProvenance } from "@domino/sim";
import { useState } from "react";
import { IconGallery } from "../icons/IconGallery";
import { BrainMap } from "./BrainMap";
import { OperatingSelectorControls } from "./CompanySwitcher";
import { ConnectView } from "./ConnectPage";
import { SourceContents } from "./OperatingProvenanceStrip";
import { WorkerPage } from "./WorkerPage";
import {
  DEFAULT_OPERATING_SELECTION,
  OPERATING_DEMO_LABEL,
  type OperatingSelection,
} from "./company";
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
          <p className="text-xs text-muted-foreground">
            {selection.company === "2u"
              ? OPERATING_DEMO_LABEL
              : "Fictional company inspired by public filings."}{" "}
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
