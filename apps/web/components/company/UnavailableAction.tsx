import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function UnavailableAction({ label, reason }: { label: string; reason: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" title={reason}>
          <Button disabled variant="outline">
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
