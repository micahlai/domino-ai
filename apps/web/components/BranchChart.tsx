import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents, formatDate } from "@/lib/format";
import type { Branch, Cents } from "@domino/contracts";

export function BranchChart({ branches, limit }: { branches: Branch[]; limit: Cents }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Chart data preview · lender’s limit {formatCents(limit)}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Future</TableHead>
            <TableHead>Low point</TableHead>
            <TableHead>Week of</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((branch) => (
            <TableRow key={branch.id}>
              <TableCell className="min-w-36">
                <span className="block">{branch.label}</span>
                <Badge className="mt-2" variant="secondary">
                  {branch.kind}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatCents(branch.forecast.lowPoint.usable)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDate(branch.forecast.lowPoint.weekStart)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
