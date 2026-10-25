"use client";

import type { Change } from "@domino/contracts";
import { GitBranch } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  type Dispatch,
  type SetStateAction,
  createContext,
  useContext,
  useEffect,
  useId,
} from "react";
import { WhenDate } from "./RunPanels";

/**
 * Where a proposed scenario would branch from: the open run (its name and chart color) and
 * the first date the proposal's changes act. Proposal cards in the chat and in Ask a question
 * show it before saving, and the chart flashes that point on the parent's line.
 */
export type BranchParent = { runId: string; label: string; color: string };
export type BranchPreview = { key: string; date: string };
type BranchContextValue = {
  parent: BranchParent;
  /** First date a set of changes acts, or null when it changes no events. */
  startOf: (changes: Change[]) => string | null;
  preview: BranchPreview | null;
  setPreview: Dispatch<SetStateAction<BranchPreview | null>>;
};

export const BranchContext = createContext<BranchContextValue | null>(null);

/**
 * "Branches off ● Legal settlement on Dec 1" with a short flash, shown before calculating.
 * While mounted (or hovered) it asks the chart to flash the same point.
 */
export function BranchNote({ changes }: { changes: Change[] }) {
  const ctx = useContext(BranchContext);
  const key = useId();
  const reduced = useReducedMotion();
  const date = ctx?.startOf(changes) ?? null;
  const setPreview = ctx?.setPreview;
  useEffect(() => {
    if (!setPreview || !date) return;
    setPreview({ key, date });
    // Only the card that set the flash clears it; another card may have taken over.
    return () => setPreview((current) => (current?.key === key ? null : current));
  }, [setPreview, date, key]);
  if (!ctx) return null;
  const { parent } = ctx;
  return (
    <div
      className="relative flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border px-3 py-2 text-sm"
      style={{ borderColor: parent.color }}
      onPointerEnter={() => date && setPreview?.({ key, date })}
      data-testid="branch-note"
    >
      {/* Two quick flashes in the branch's color draw the eye before saving. */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-1 rounded-lg border-2"
        style={{ borderColor: parent.color }}
        initial={{ opacity: 0 }}
        animate={reduced ? { opacity: 0 } : { opacity: [0, 1, 0, 1, 0] }}
        transition={{ duration: 1.6, ease: "easeInOut" }}
      />
      <GitBranch aria-hidden="true" className="size-4 shrink-0" style={{ color: parent.color }} />
      <span>Branches off</span>
      <span className="inline-flex items-center gap-1 font-medium">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: parent.color }}
        />
        {parent.label}
      </span>
      {date ? (
        <>
          <span>on</span>
          <span className="font-medium">
            <WhenDate iso={date} />
          </span>
          <span className="text-xs text-muted-foreground">· flashing on the chart</span>
        </>
      ) : (
        <span className="text-muted-foreground">· rules only, the same cash timeline</span>
      )}
    </div>
  );
}
