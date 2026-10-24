"use client";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

export function NextWeekDialog({
  currentWeek,
  onAdvance,
}: { currentWeek: number; onAdvance?: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [requestedWeek, setRequestedWeek] = useState<number>();
  const [message, setMessage] = useState("");
  const waiting = requestedWeek !== undefined && currentWeek <= requestedWeek;
  useEffect(() => {
    if (requestedWeek !== undefined && currentWeek > requestedWeek)
      setMessage("The next week is ready. The cash forecast has been updated.");
  }, [currentWeek, requestedWeek]);
  return (
    <div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" disabled={pending || waiting}>
            {waiting ? "Preparing next week…" : "Next week"}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prepare the next week?</DialogTitle>
            <DialogDescription>
              Pull the next week of mock company records, compare the last forecast with results,
              and prepare a new forecast. No money moves.
            </DialogDescription>
          </DialogHeader>
          {!onAdvance ? (
            <p className="text-sm text-muted-foreground">
              New weeks cannot be prepared yet. Your saved forecasts are available to review.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={!onAdvance || pending}
              onClick={async () => {
                if (!onAdvance || pending) return;
                setPending(true);
                try {
                  await onAdvance();
                  setRequestedWeek(currentWeek);
                  setMessage("Next week requested. Waiting for the updated records.");
                  setOpen(false);
                } catch {
                  setMessage("Could not request the next week. Please try again.");
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "Requesting…" : "Confirm next week"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {message ? (
        <output className="mt-2 block max-w-sm text-xs text-muted-foreground" aria-live="polite">
          {message}
        </output>
      ) : null}
    </div>
  );
}
