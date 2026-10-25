/** Pure seed draft from the snapshot named by one pinned Field analyst run. */
import { type Snapshot, type WeeklySeedV1, firstForecastWeek } from "@domino/contracts";
import { scheduledItems } from "@domino/engine";

export function pinnedOptionSeedDraft(args: {
  snapshot: Snapshot;
  companyName: string;
  seedId: string;
  pinnedAt: string;
}): Omit<WeeklySeedV1, "contentHash"> {
  return {
    schemaVersion: 1,
    id: args.seedId,
    exportedAt: args.pinnedAt,
    // The Timeline company is the snapshot's semantic world ID, not Field's Convex row ID.
    company: { id: args.snapshot.companyId, name: args.companyName },
    asOf: firstForecastWeek(args.snapshot.asOf),
    snapshot: args.snapshot,
    scheduledItems: scheduledItems(args.snapshot),
    // Findings were not pinned at analyst start. They are not financial inputs and are omitted.
    findings: [],
  };
}
