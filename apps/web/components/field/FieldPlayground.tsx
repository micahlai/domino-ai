"use client";

import { IconGallery } from "../icons/IconGallery";
import { BrainMap } from "./BrainMap";
import { ConnectView } from "./ConnectPage";
import { WorkerPage } from "./WorkerPage";
import { DemoConnectData } from "./connect-data";
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
