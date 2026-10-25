"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { type ChangeEvent, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  CSV_COLUMNS,
  CSV_KINDS,
  CSV_LABEL,
  type CsvKind,
  type CsvRecord,
  csvRecords,
  csvTemplate,
  validateCsvRows,
} from "../../convex/lib/judge";
import { Button } from "../ui/button";
import { Section } from "../ui/page";
import { Select } from "../ui/select";
import { FieldLabel, ProofLabel, errorText } from "./shared";

// CSV upload: download a template, paste or pick a file, see per-row errors before sending.
// The backend (fieldJudge.importCsv) re-checks every row with the same rules and plants only
// valid rows, through the same path as the scenario form.

type Rejected = { line: number; errors: string[] };
type Check = { error: string } | { records: CsvRecord[]; rows: ReturnType<typeof validateCsvRows> };

export function CsvImport({ companyId, asOf }: { companyId: Id<"companies">; asOf: string }) {
  const customers = useQuery(api.fieldJudge.customers, { companyId });
  const importCsv = useMutation(api.fieldJudge.importCsv);
  const [kind, setKind] = useState<CsvKind>("bills");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ accepted: number; rejected: Rejected[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useMemo((): Check | null => {
    if (!text.trim()) return null;
    const parsed = csvRecords(kind, text);
    if ("error" in parsed) return { error: parsed.error };
    const rows = validateCsvRows(kind, parsed.records, {
      asOf,
      customerIds: new Set((customers ?? []).map((c) => c.id)),
    });
    return { records: parsed.records, rows };
  }, [kind, text, asOf, customers]);
  const valid = check && "rows" in check ? check.rows.filter((r) => r.entry).length : 0;
  const invalid = check && "rows" in check ? check.rows.filter((r) => !r.entry) : [];

  function download() {
    const body = csvTemplate(kind, asOf, customers?.[0]?.id);
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `domino-${kind}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200_000) {
      setError("That file is over 200 KB; upload at most 50 rows");
      return;
    }
    setText(await file.text());
    setSent(null);
    setError(null);
  }

  async function send() {
    if (!check || !("records" in check)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importCsv({ companyId, kind, rows: check.records });
      setSent({ accepted: r.accepted, rejected: r.rejected });
      setText("");
    } catch (e) {
      const data = e instanceof ConvexError ? (e.data as { rejected?: Rejected[] }) : null;
      if (data?.rejected) setSent({ accepted: 0, rejected: data.rejected });
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Upload your own rows"
      description="Bank transactions, bills or invoices as CSV. Every row is checked; only valid rows go in."
      actions={<ProofLabel kind="simulated">Becomes simulated tool data</ProofLabel>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] space-y-1.5">
            <FieldLabel htmlFor="judge-csv-kind">Rows are</FieldLabel>
            <Select
              id="judge-csv-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as CsvKind);
                setSent(null);
              }}
            >
              {CSV_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CSV_LABEL[k]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={download}>
            Download template
          </Button>
          <label className="inline-flex">
            <span className="sr-only">Choose a CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={pick}
              className="text-[13px] text-muted-foreground file:mr-2 file:h-[var(--control-h)] file:cursor-pointer file:rounded-md file:border file:border-input file:bg-card file:px-3 file:text-sm file:font-medium file:text-foreground"
            />
          </label>
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="judge-csv-text">
            {`Or paste CSV. Columns: ${[...CSV_COLUMNS[kind].required, ...CSV_COLUMNS[kind].optional.map((c) => `${c} (optional)`)].join(", ")}`}
          </FieldLabel>
          <textarea
            id="judge-csv-text"
            rows={5}
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSent(null);
            }}
            placeholder={csvTemplate(kind, asOf, customers?.[0]?.id)}
            className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-[13px] shadow-xs placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
          />
        </div>
        {check && "error" in check ? (
          <p role="alert" className="text-sm text-destructive">
            {check.error}
          </p>
        ) : null}
        {invalid.length > 0 ? <RowErrors rows={invalid} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={busy || valid === 0} onClick={send}>
            {valid > 0 ? `Import ${valid} valid row${valid === 1 ? "" : "s"}` : "Import rows"}
          </Button>
          {check && "rows" in check ? (
            <span className="text-[13px] text-muted-foreground">
              {valid} valid, {invalid.length} with errors
            </span>
          ) : null}
        </div>
        {sent ? (
          <output className="block text-sm">
            Imported {sent.accepted} row{sent.accepted === 1 ? "" : "s"}
            {sent.rejected.length > 0 ? `, skipped ${sent.rejected.length}` : ""}. The agents are
            reading them now.
          </output>
        ) : null}
        {sent && sent.rejected.length > 0 ? <RowErrors rows={sent.rejected} /> : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function RowErrors({ rows }: { rows: Rejected[] }) {
  return (
    <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-destructive/5 p-3 text-[13px]">
      {rows.slice(0, 20).map((r) => (
        <li key={r.line}>
          <span className="font-medium">Line {r.line}:</span>{" "}
          <span className="text-destructive">{r.errors.join("; ")}</span>
        </li>
      ))}
    </ul>
  );
}
