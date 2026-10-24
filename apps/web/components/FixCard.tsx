import { ProofDrawer } from "@/components/ProofDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { FixCandidate } from "@domino/contracts";

export function FixCard({ fix }: { fix: FixCandidate }) {
  return (
    <Card className="shadow-none">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{fix.label}</p>
          <Badge variant="secondary">{fix.risk} risk</Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{fix.costNote}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled variant="secondary">
            Simulate
          </Button>
          <Button disabled>Approve</Button>
          <ProofDrawer evidence={fix.evidence} />
        </div>
        <p className="text-xs text-muted-foreground">
          Simulation and approval will be connected in a later task.
        </p>
      </CardContent>
    </Card>
  );
}
