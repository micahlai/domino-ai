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

export function AddEventDialog({ risks }: { risks: RiskEvent[] }) {
  const [selected, setSelected] = useState<string>();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="mr-2 size-4" aria-hidden="true" />
          Preview an event
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What could happen next?</DialogTitle>
          <DialogDescription>
            Choose a sample event. This preview does not create a future or change company data.
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
        <output className="block text-sm text-muted-foreground">
          {selected
            ? "Event selected for preview. Creating futures comes in the flows task."
            : "Select an event to preview."}
        </output>
      </DialogContent>
    </Dialog>
  );
}
