"use client";
import type { Evidence } from "@domino/contracts";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../ui/sheet";
/** Uses the shared proof-drawer primitives, with explicit scenario assumptions in its heading. */
export function AnalysisProof({
  evidence,
  description,
}: { evidence: Evidence[]; description: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Show proof</Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto [overflow-wrap:anywhere]">
        <SheetHeader>
          <SheetTitle>Records and assumptions behind this scenario</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {evidence.length ? (
            evidence.map((e, i) => (
              <div key={`${i}-${e.ref}`} className="space-y-2">
                <Badge variant="secondary">{e.source}</Badge>
                <p className="break-all text-sm font-medium">{e.ref}</p>
                {e.quote ? (
                  <blockquote className="border-l-2 pl-3 text-sm">{e.quote}</blockquote>
                ) : null}
                <p className="text-sm text-muted-foreground">{e.note}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No source evidence was attached to this scenario.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
