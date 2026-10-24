"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { RiskEvent } from "@domino/contracts";
import { Plus } from "lucide-react";
import { useState } from "react";

export function AddEventDialog({
  risks,
  onAdd,
}: { risks: RiskEvent[]; onAdd?: (risk: RiskEvent) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string>();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="mr-2 size-4" aria-hidden="true" />
          {onAdd ? "Add event" : "Preview an event"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What could happen next?</DialogTitle>
          <DialogDescription>
            {onAdd
              ? "Choose an event to add to the forecast."
              : "Choose a sample event. This preview does not create a future or change company data."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {risks.map((risk) => (
            <Button
              key={risk.id}
              variant={selected === risk.id ? "secondary" : "outline"}
              className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
              aria-pressed={selected === risk.id}
              onClick={() => setSelected(risk.id)}
            >
              {risk.label}
            </Button>
          ))}
        </div>
        {onAdd ? (
          <Button
            disabled={!selected || pending}
            onClick={async () => {
              const risk = risks.find((risk) => risk.id === selected);
              if (!risk) return;
              setPending(true);
              try {
                await onAdd(risk);
                setMessage("Event requested. The forecast will update when it is ready.");
              } catch {
                setMessage("Could not add this event. Please try again.");
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Adding…" : "Add event"}
          </Button>
        ) : null}
        <output className="block text-sm text-muted-foreground">
          {message ||
            (selected
              ? onAdd
                ? "Review your selection before adding it to the forecast."
                : "Event selected for preview. No company records change."
              : "Select an event to preview.")}
        </output>
      </DialogContent>
    </Dialog>
  );
}
