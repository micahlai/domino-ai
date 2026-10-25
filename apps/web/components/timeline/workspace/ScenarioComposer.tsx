"use client";

import { useId, useState } from "react";
import { Button } from "../../ui/button";
import { EventForm, type EventFormProps } from "./EventForm";
import { WhenDate } from "./RunPanels";

/** A chart-local editor: hiding it never unmounts the person's draft. */
export function ScenarioComposer({
  selectedWeek,
  ...form
}: Omit<EventFormProps, "defaultDate"> & { selectedWeek: string | null }) {
  const [open, setOpen] = useState(false);
  const editorId = useId();
  const inForecast = selectedWeek !== null && selectedWeek >= form.firstWeek;
  const defaultDate = inForecast ? selectedWeek : form.firstWeek;

  return (
    <section
      aria-label="Add a scenario on this timeline"
      className="min-w-0 space-y-4 border-t pt-4 [&_button]:h-auto [&_button]:min-h-8 [&_button]:max-w-full [&_button]:whitespace-normal"
      data-testid="timeline-composer"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="text-sm text-foreground">
            {inForecast ? "Selected forecast week" : "New events start in the week"} of{" "}
            <WhenDate iso={defaultDate} />
          </p>
          <p>
            {open
              ? "Dates you enter stay fixed when you explore other weeks."
              : "Explore a change here, then review it before saving a new scenario."}
          </p>
          {form.suggestion && !open ? (
            <p>The selected scheduled item is available in the editor.</p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant={open ? "outline" : "default"}
          aria-expanded={open}
          aria-controls={editorId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide editor · keep draft" : "Add scenario"}
        </Button>
      </div>
      <div id={editorId} hidden={!open}>
        <EventForm {...form} defaultDate={defaultDate} />
      </div>
    </section>
  );
}
