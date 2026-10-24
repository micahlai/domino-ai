"use client";

import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  type NodeProps,
  getStraightPath,
} from "@xyflow/react";
import { FolderOpen, Toolbox } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ZoneNode } from "./graph";

// Presentation-only parts of the company map: the Sources / Toolbox frames and the dependency edge.

const ZONE = {
  sources: {
    title: "Sources",
    Icon: FolderOpen,
    some: "Recorded source steps",
    none: "None recorded yet",
    frame: "border-sky-400/30 bg-sky-400/[0.04]",
    text: "text-sky-300",
  },
  toolbox: {
    title: "Toolbox",
    Icon: Toolbox,
    some: "Recorded tool steps",
    none: "None recorded yet",
    frame: "border-amber-400/30 bg-amber-400/[0.04]",
    text: "text-amber-300",
  },
} as const;

/** A light frame around real members. It is never a running thing and never takes clicks. */
export function ZoneView({ data }: NodeProps<ZoneNode>) {
  const zone = ZONE[data.group];
  return (
    <div className={`size-full rounded-3xl border border-dashed p-2.5 ${zone.frame}`}>
      <p className={`flex items-center gap-1.5 text-xs font-medium leading-4 ${zone.text}`}>
        <zone.Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {zone.title} · {data.count}
      </p>
      <p className="text-xs leading-4 text-muted-foreground">
        {data.count ? zone.some : zone.none}
      </p>
    </div>
  );
}

export type FlowEdgeData = { pulse?: string };
export type FlowEdgeType = Edge<FlowEdgeData, "flow">;

export const PULSE_SECONDS = 0.9;

/**
 * An operation dependency. When a new recorded step lands on it, one dot travels once from the
 * step it depends on to the step that changed. Reduced motion draws no dot. The dot is a marker
 * for recorded activity, not a measurement of data moved.
 */
export function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  data,
}: EdgeProps<FlowEdgeType>) {
  const reduced = useReducedMotion();
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {data?.pulse && !reduced ? (
        <motion.circle
          key={data.pulse}
          data-pulse={data.pulse}
          r={4}
          className="pointer-events-none fill-primary"
          initial={{ cx: sourceX, cy: sourceY, opacity: 1 }}
          animate={{ cx: targetX, cy: targetY, opacity: [1, 1, 0] }}
          transition={{ duration: PULSE_SECONDS, ease: "easeInOut", times: [0, 0.75, 1] }}
        />
      ) : null}
    </>
  );
}
