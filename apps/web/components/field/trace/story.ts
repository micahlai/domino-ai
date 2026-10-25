import type { FieldTrace } from "@/lib/field-trace-contract";
import { formatFullDate } from "../../timeline/baseline/format";

/** Frozen source context, shown in place of the current-company header strip. */
export function traceProvenanceLine(trace: FieldTrace): string | null {
  const source = trace.inputs?.provenance;
  if (!source) return null;
  return `${source.label} · Reconstructed ledger ${formatFullDate(source.periodStart)} to ${formatFullDate(source.periodEnd)} · Public report ${formatFullDate(source.reportedAt)}`;
}
