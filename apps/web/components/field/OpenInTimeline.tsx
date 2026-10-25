"use client";

import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { useSelectedCompany } from "./company";

// "Open in Timeline": the Field side of the TL7 joint seam (convex/fieldTimeline.ts). Saves the
// selected company's latest books as a Timeline forecast, with Field's lender rules and model as
// the reviewed assumptions, starts Timeline's risk analysis and opens the saved run. The same
// books open the same run again. Nothing is paid or moved.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export const OPEN_IN_TIMELINE_NOTE =
  "Saves the latest books as a Timeline forecast with this company's lender rules, then starts Timeline's risk analysis. Nothing is paid or moved.";

export function OpenInTimeline({
  variant = "default",
  label = "Open in Timeline",
  className,
}: {
  variant?: "default" | "outline";
  label?: string;
  className?: string;
}) {
  if (!CONVEX_URL)
    return (
      <Button variant="outline" disabled className={cn("h-11 shrink-0 sm:h-9", className)}>
        Timeline needs the live backend
      </Button>
    );
  return <LiveOpen variant={variant} label={label} className={className} />;
}

function LiveOpen({
  variant,
  label,
  className,
}: { variant: "default" | "outline"; label: string; className?: string }) {
  const { companyId } = useSelectedCompany();
  const open = useAction(api.fieldTimeline.openInTimeline);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    if (!companyId || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const r = await open({ companyId, reviewed: true });
      router.push(r.route);
    } catch (e) {
      const data = e instanceof ConvexError ? (e.data as { message?: unknown }) : null;
      setError(
        typeof data?.message === "string"
          ? `Timeline did not open: ${data.message}`
          : "Timeline did not open. Try again; the same books reopen the same saved run.",
      );
      setPending(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        onClick={go}
        disabled={!companyId || pending}
        title={OPEN_IN_TIMELINE_NOTE}
        data-testid="open-in-timeline"
        className={cn("h-11 shrink-0 sm:h-9", className)}
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        ) : null}
        {pending ? "Opening the timeline..." : label}
        {pending ? null : <ArrowRight aria-hidden="true" />}
      </Button>
      {error ? (
        <span role="alert" className="max-w-xs text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
