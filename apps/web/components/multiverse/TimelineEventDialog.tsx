"use client";

import type { PastEvent } from "@domino/contracts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { inspectionCash, inspectionDate } from "./inspection";

const eventKinds: Record<PastEvent["kind"], string> = {
  late_payment: "Late payment",
  churn: "Customer departure",
  big_deal: "New deal",
  spend_spike: "Higher spending",
  hire: "Hiring",
  other: "Recorded event",
};

export function TimelineEventDialog({
  event,
  onClose,
  returnFocus,
}: {
  event: PastEvent | undefined;
  onClose: () => void;
  returnFocus: () => void;
}) {
  return (
    <Dialog
      open={Boolean(event)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg"
        onCloseAutoFocus={(close) => {
          close.preventDefault();
          returnFocus();
        }}
      >
        {event ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 leading-snug">{event.label}</DialogTitle>
              <DialogDescription>
                {inspectionDate(event.date)} · {eventKinds[event.kind]}
              </DialogDescription>
            </DialogHeader>
            {event.amount !== undefined ? (
              <p className="text-sm">
                Recorded cash effect{" "}
                <span className="ml-2 font-medium tabular-nums">
                  {inspectionCash(event.amount)}
                </span>
              </p>
            ) : null}
            <div className="space-y-4 text-sm">
              <h3 className="font-medium">Source records</h3>
              {event.evidence.length ? (
                event.evidence.map((record, index) => (
                  <div key={`${record.source}:${record.ref}:${index}`} className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {record.source} · <span className="break-all">{record.ref}</span>
                    </p>
                    {record.quote ? (
                      <blockquote className="border-l-2 pl-3 leading-6">{record.quote}</blockquote>
                    ) : null}
                    <p className="leading-6">{record.note}</p>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">
                  No source records have been attached to this event yet.
                </p>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
