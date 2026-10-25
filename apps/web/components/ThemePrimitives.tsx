"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader, Section, StatTile } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus } from "lucide-react";
import { useState } from "react";

// Preview values only, written as display strings: nothing here is loaded or calculated.
const rows = [
  { week: "Nov 2", inflow: "$412K", outflow: "$388K", balance: "$3.42M", status: "ok" },
  { week: "Nov 9", inflow: "$296K", outflow: "$451K", balance: "$3.27M", status: "watch" },
  { week: "Nov 16", inflow: "$188K", outflow: "$470K", balance: "$2.98M", status: "below" },
] as const;
const status = {
  ok: <Badge variant="success">Above limit</Badge>,
  watch: <Badge variant="warning">Close to limit</Badge>,
  below: <Badge variant="destructive">Below limit</Badge>,
};
const ranges = [
  { value: "4w", label: "4 weeks" },
  { value: "13w", label: "13 weeks" },
  { value: "26w", label: "26 weeks" },
] as const;

/** Every shared primitive and layout helper in one place, for checking the theme. */
export function ThemePrimitives() {
  const [range, setRange] = useState<(typeof ranges)[number]["value"]>("13w");
  const [alerts, setAlerts] = useState(true);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Kestrel Data · preview values"
        title="Cash over the next 13 weeks"
        description="Page header, stat tiles, a section with a table and the form controls."
        actions={
          <>
            <Button variant="outline">Export</Button>
            <Button>
              <Plus aria-hidden="true" />
              Add event
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Cash today"
          value="$3.61M"
          unit="Oct 30"
          delta="+$84K vs last week"
          tone="positive"
        />
        <StatTile
          label="Lowest point"
          value="$2.98M"
          unit="Nov 16"
          delta="$20K under the limit"
          tone="negative"
        />
        <StatTile label="Lender's limit" value="$3.00M" unit="minimum" />
        <StatTile
          label="Scenarios that pass"
          value="7 of 11"
          delta="Watch Acme paying late"
          tone="warning"
        />
      </div>
      <Section
        title="Weekly cash"
        description="Preview rows. Numbers are tabular so columns line up."
        actions={
          <Segmented
            label="Range"
            name="theme-range"
            options={ranges}
            value={range}
            onChange={setRange}
          />
        }
        flush
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week of</TableHead>
              <TableHead className="text-right">Money in</TableHead>
              <TableHead className="text-right">Money out</TableHead>
              <TableHead className="text-right">Cash at end</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.week}>
                <TableCell className="font-medium">{row.week}</TableCell>
                <TableCell className="text-right">{row.inflow}</TableCell>
                <TableCell className="text-right">{row.outflow}</TableCell>
                <TableCell className="text-right font-medium">{row.balance}</TableCell>
                <TableCell>{status[row.status]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Buttons and badges">
          <div className="flex flex-wrap gap-2">
            <Button>Approve</Button>
            <Button variant="outline">Show proof</Button>
            <Button variant="secondary">Next week</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="destructive">Remove</Button>
            <Button variant="link">Open record</Button>
            <Button size="sm" variant="outline">
              Small
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Sample data</Badge>
            <Badge variant="outline">Draft</Badge>
            <Badge variant="success">Working fix</Badge>
            <Badge variant="warning">Watch</Badge>
            <Badge variant="destructive">Broken rule</Badge>
          </div>
        </Section>
        <Section title="Form controls">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="theme-customer" className="text-[13px] font-medium">
                Customer
              </label>
              <Input id="theme-customer" placeholder="Acme Corp" />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="theme-event" className="text-[13px] font-medium">
                Event
              </label>
              <Select id="theme-event" defaultValue="late">
                <option value="late">Pays late</option>
                <option value="churn">Cancels</option>
                <option value="cut">Cuts the plan</option>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="theme-alerts" checked={alerts} onCheckedChange={setAlerts} />
              <label htmlFor="theme-alerts" className="text-sm">
                Weekly email
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm">
                    Hover for tooltip
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Every number links to its source.</TooltipContent>
              </Tooltip>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    Open dialog
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Apply this fix?</DialogTitle>
                    <DialogDescription>
                      Preview only. Domino never moves money; a person approves every action.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button>Approve</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
