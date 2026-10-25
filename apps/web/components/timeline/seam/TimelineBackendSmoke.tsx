"use client";

import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { CaseDataSchema } from "../../historical/live";

const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

/** One read-only public query against the lane's own local backend. No mutation, no provider. */
export function TimelineBackendSmoke({ caseId }: { caseId: string }) {
  return configured ? <Live caseId={caseId} /> : <Status text="Backend not configured" />;
}

function Live({ caseId }: { caseId: string }) {
  const client = useConvex();
  const [text, setText] = useState("Querying historical.getCase...");
  useEffect(() => {
    let live = true;
    client.query(api.historical.getCase, { caseId }).then(
      (raw) => {
        if (!live) return;
        const r = CaseDataSchema.safeParse(raw);
        setText(
          r.success
            ? `OK: historical.getCase(${caseId}) returned ${r.data.case.companyName}, ${r.data.case.facts.length} facts, cutoff ${r.data.knowledgeCutoff}, revealed ${r.data.revealed}`
            : "Failed: historical.getCase returned an unexpected shape",
        );
      },
      (e: unknown) => live && setText(`Failed: ${e instanceof Error ? e.message : "query failed"}`),
    );
    return () => {
      live = false;
    };
  }, [client, caseId]);
  return <Status text={text} />;
}

function Status({ text }: { text: string }) {
  return (
    <section className="space-y-1">
      <h2 className="text-lg font-medium">Backend smoke</h2>
      <output data-testid="backend-smoke" className="block font-mono text-xs">
        {text}
      </output>
    </section>
  );
}
