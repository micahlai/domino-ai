"use client";

import { BrainMap } from "./BrainMap";
import { WorkerPage } from "./WorkerPage";
import { DemoFieldData } from "./data";

/**
 * Both Field pages on demo data, always: the playground never reads or writes the backend.
 * They share one demo store, so a button pressed in one shows up in the other.
 */
export function FieldPlayground() {
  return (
    <DemoFieldData note="Playground fixture">
      <div className="space-y-16">
        <section id="WorkerPage" className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Worker page (/field)</h2>
          <WorkerPage />
        </section>
        <section id="BrainMap" className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Brain map (/field/map)</h2>
          <BrainMap />
        </section>
      </div>
    </DemoFieldData>
  );
}
