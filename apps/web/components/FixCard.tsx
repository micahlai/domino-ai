"use client";

import { ProofDrawer } from "@/components/ProofDrawer";
import { UnavailableAction } from "@/components/company/UnavailableAction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCents, formatDate } from "@/lib/format";
import type { Branch, Cents, FixCandidate } from "@domino/contracts";
import { useState } from "react";

export interface FixCardProps {
  fix: FixCandidate;
  gain?: Cents;
  simulatedBranch?: Branch;
  onSimulate?: () => Promise<void>;
  onApprove?: () => Promise<void>;
  sample?: boolean;
}

export function FixCard({
  fix,
  gain,
  simulatedBranch,
  onSimulate,
  onApprove,
  sample = false,
}: FixCardProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const decided = saved || simulatedBranch?.status === "approved";
  async function approve() {
    if (!onApprove || pending) return;
    setPending(true);
    setFailed(false);
    setMessage("");
    try {
      await onApprove();
      setSaved(true);
      setMessage(
        sample
          ? "Sample approval previewed. No company records changed."
          : "Approval saved. Your decision is recorded; no action was executed.",
      );
      setOpen(false);
    } catch {
      setFailed(true);
      setMessage("Could not save your approval. Please try again.");
    } finally {
      setPending(false);
    }
  }
  async function simulate() {
    if (!onSimulate || pending) return;
    setPending(true);
    setFailed(false);
    setMessage("");
    try {
      await onSimulate();
      setMessage("Simulation requested. The saved forecast will update when it is ready.");
    } catch {
      setFailed(true);
      setMessage("Could not request this simulation. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Card className="shadow-none">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{fix.label}</h3>
          <Badge variant="secondary">{fix.risk} risk</Badge>
        </div>
        {gain !== undefined ? (
          <p className="text-sm font-medium text-primary">
            {gain >= 0 ? "+" : ""}
            {formatCents(gain)} at the low point
            {simulatedBranch ? ` · ${formatDate(simulatedBranch.forecast.lowPoint.weekStart)}` : ""}
          </p>
        ) : null}
        <p className="text-sm leading-6 text-muted-foreground">{fix.costNote}</p>
        {simulatedBranch ? (
          <p className="text-xs text-muted-foreground">
            Saved simulation: {formatCents(simulatedBranch.forecast.lowPoint.usable)} low point on{" "}
            {formatDate(simulatedBranch.forecast.lowPoint.weekStart)}.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {onSimulate ? (
            <Button variant="secondary" disabled={pending} onClick={simulate}>
              Simulate
            </Button>
          ) : (
            <UnavailableAction
              label="Simulate"
              reason="New simulations are not available yet. You can review the saved simulation."
            />
          )}
          {decided ? (
            <Badge className="self-center bg-primary/15 text-primary">
              {sample ? "Sample approved" : "Approved"}
            </Badge>
          ) : onApprove && simulatedBranch ? (
            <Dialog
              open={open}
              onOpenChange={(next) => {
                if (!pending) setOpen(next);
              }}
            >
              <DialogTrigger asChild>
                <Button disabled={pending}>Approve</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Approve this plan?</DialogTitle>
                  <DialogDescription>
                    {sample
                      ? "Sample data only. This previews the approval flow."
                      : "This records your decision. Domino will not move money or contact anyone."}
                  </DialogDescription>
                </DialogHeader>
                <p className="text-sm font-medium">{fix.label}</p>
                <p className="text-sm text-muted-foreground">{fix.costNote}</p>
                <p className="text-sm">
                  Saved low point: {formatCents(simulatedBranch.forecast.lowPoint.usable)} on{" "}
                  {formatDate(simulatedBranch.forecast.lowPoint.weekStart)}.
                </p>
                {!sample ? (
                  <p className="text-xs text-muted-foreground">
                    This demo records your decision as an unverified demo user.
                  </p>
                ) : null}
                {failed ? (
                  <p role="alert" className="text-sm text-destructive">
                    {message}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button disabled={pending} onClick={approve}>
                    {pending
                      ? "Saving approval…"
                      : sample
                        ? "Preview approval"
                        : "Confirm approval"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <UnavailableAction
              label="Approve"
              reason="A matching saved simulation is needed before you can approve this fix."
            />
          )}
          <ProofDrawer evidence={fix.evidence} />
        </div>
        {!onSimulate ? (
          <p className="text-xs text-muted-foreground">New simulations are not available yet.</p>
        ) : null}
        {message && (!failed || !open) ? (
          <p role={failed ? "alert" : "status"} className="text-sm text-muted-foreground">
            {message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
