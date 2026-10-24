"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Evidence } from "@domino/contracts";
import { FileText } from "lucide-react";

export function ProofDrawer({ evidence }: { evidence: Evidence[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <FileText className="mr-2 size-4" aria-hidden="true" />
          Show proof
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>The records behind the forecast</SheetTitle>
          <SheetDescription>Sample Kestrel records from the shared fixtures.</SheetDescription>
        </SheetHeader>
        <div className="mt-8 space-y-8">
          {evidence.map((item) => (
            <div key={`${item.source}:${item.ref}`} className="space-y-3">
              <Badge variant="secondary">{item.source}</Badge>
              <p className="break-words text-sm font-medium">{item.ref}</p>
              {item.quote ? (
                <blockquote className="border-l-2 pl-4 text-sm leading-6">{item.quote}</blockquote>
              ) : null}
              <p className="text-sm leading-6 text-muted-foreground">{item.note}</p>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
