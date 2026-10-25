"use client";

import { useId, useState } from "react";
import { Button } from "../../ui/button";
import { EventForm, type EventFormProps } from "./EventForm";
import { WhenDate } from "./RunPanels";

/** A chart-local editor: hiding it never unmounts the person's draft. */
export function ScenarioComposer({
  selectedWeek,
  open: openProp,
  onOpenChange,
  ...form
}: Omit<EventFormProps, "defaultDate"> & {
  selectedWeek: string | null;
  /** Optional control from the page actions ("Try an event"). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const editorId = useId();
  const inForecast = selectedWeek !== null && selectedWeek >= form.firstWeek;
  const defaultDate = inForecast ? selectedWeek : form.firstWeek;

  return (
    <section
      id="try-an-event"
      aria-label="Try an event on this timeline"
      className="min-w-0 scroll-mt-24 space-y-4 rounded-lg border bg-card p-4 shadow-xs [&_button]:h-auto [&_button]:min-h-8 [&_button]:max-w-full [&_button]:whitespace-normal max-sm:[&_button]:min-h-11"
      data-testid="timeline-composer"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[15px] font-semibold tracking-[-0.01em]">Try an event</p>
          <p className="text-sm text-muted-foreground">
            {open ? (
              "Dates you enter stay fixed when you pick other weeks."
            ) : (
              <>
                Add money in or out, move a bill or delay an invoice, starting the week of{" "}
                <WhenDate iso={defaultDate} />. You review it before anything is saved.
              </>
            )}
          </p>
          {form.suggestion && !open ? (
            <p className="text-xs text-muted-foreground">
              The scheduled item you picked is ready in the editor.
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          aria-expanded={open}
          aria-controls={editorId}
          onClick={() => setOpen(!open)}
          data-testid="composer-toggle"
        >
          {open ? "Hide editor · keep draft" : "Open the event form"}
        </Button>
      </div>
      <div id={editorId} hidden={!open}>
        <EventForm {...form} defaultDate={defaultDate} />
      </div>
    </section>
  );
}
