"use client";

import { useMutation, useQueries } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Skeleton } from "../../ui/skeleton";
import { type BaselineDraft, BaselineImportForm } from "./BaselineImportForm";
import { SavedBaselineState } from "./SavedBaselineView";
import {
  type BaselineKey,
  SaveBaselineResultSchema,
  baselineHref,
  baselineKeyFromSearch,
  getBaselineRef,
  readBaseline,
  saveBaselineRef,
} from "./api";

const ErrorData = z.union([z.string(), z.object({ message: z.string() }).passthrough()]);

/** Plain words for a failed save. A lost answer may still have been saved, so never say it was not. */
export function describeSaveError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = ErrorData.safeParse(error.data);
    if (data.success)
      return `Not saved: ${typeof data.data === "string" ? data.data : data.data.message}`;
  }
  return "Could not confirm the save. It may or may not have been recorded. Check the connection and try again: the retry uses the same request, so it will not be saved twice.";
}

const NOT_CONNECTED =
  "This page is not connected to the forecast service, so nothing can be saved.";

function Layout({ saved, form }: { saved?: ReactNode; form: ReactNode }) {
  return (
    <section className="space-y-8" aria-label="Baseline forecast">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Baseline forecast</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Import a weekly seed, review the assumptions, and save a 13-week cash forecast. A saved
          forecast opens again from its link and never changes.
        </p>
      </div>
      {saved}
      {form}
    </section>
  );
}

function Saved({ baselineKey }: { baselineKey: BaselineKey }) {
  const queries = useMemo(
    () => ({ get: { query: getBaselineRef, args: baselineKey } }),
    [baselineKey],
  );
  // useQueries hands back errors as values instead of throwing, so a failure stays on screen.
  const raw = useQueries(queries).get as unknown;
  if (raw instanceof Error)
    return (
      <div role="alert" className="rounded-lg border p-5 text-sm">
        <p className="font-medium">The saved forecast could not be loaded</p>
        <p className="mt-1 text-muted-foreground">
          Check the connection and reload the page. Nothing has changed.
        </p>
      </div>
    );
  return <SavedBaselineState read={readBaseline(raw, baselineKey)} />;
}

function Connected() {
  const router = useRouter();
  const search = useSearchParams().toString();
  const link = baselineKeyFromSearch(search);
  const key = link.kind === "key" ? link.key : undefined;
  const companyId = key?.companyId;
  const runId = key?.runId;
  const stableKey = useMemo(
    () => (companyId && runId ? { companyId, runId } : undefined),
    [companyId, runId],
  );
  const save = useMutation(saveBaselineRef);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  // One request id per exact payload: a retry of the same inputs reuses it.
  const requestIds = useRef(new Map<string, string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function onSave(draft: BaselineDraft) {
    if (pending) return;
    const payload = JSON.stringify(draft);
    const requestId = requestIds.current.get(payload) ?? crypto.randomUUID();
    requestIds.current.set(payload, requestId);
    setPending(true);
    setError(undefined);
    try {
      const parsed = SaveBaselineResultSchema.safeParse(await save({ requestId, ...draft }));
      if (!alive.current) return;
      if (!parsed.success)
        return setError(
          "The service answered, but the answer could not be used. The forecast may have been saved.",
        );
      router.replace(baselineHref(parsed.data, window.location.pathname), { scroll: false });
    } catch (e) {
      if (alive.current) setError(describeSaveError(e));
    } finally {
      if (alive.current) setPending(false);
    }
  }

  const saved =
    link.kind === "partial" ? (
      <div role="alert" className="rounded-lg border p-5 text-sm">
        <p className="font-medium">This link is incomplete</p>
        <p className="mt-1 text-muted-foreground">
          A saved forecast link needs both a company and a forecast. Save a new baseline below.
        </p>
      </div>
    ) : stableKey ? (
      <div className="space-y-3">
        <Saved baselineKey={stableKey} />
        <Link
          href={baselineHref(stableKey)}
          className="inline-block text-sm text-primary underline-offset-4 hover:underline"
          data-testid="baseline-link"
        >
          Link to this saved forecast
        </Link>
      </div>
    ) : undefined;

  return (
    <Layout
      saved={saved}
      form={<BaselineImportForm onSave={onSave} pending={pending} error={error} />}
    />
  );
}

function Unconnected() {
  const link = baselineKeyFromSearch(useSearchParams().toString());
  return (
    <Layout
      saved={
        link.kind === "none" ? undefined : <SavedBaselineState read={{ state: "unavailable" }} />
      }
      form={<BaselineImportForm onSave={() => undefined} unavailable={NOT_CONNECTED} />}
    />
  );
}

/** Baseline import, save and reopen. Missing service connection stays visible, never faked. */
export function BaselineLive() {
  return (
    <Suspense
      fallback={
        <div className="space-y-3" aria-busy="true">
          <output className="block text-sm text-muted-foreground">
            Reading the page address...
          </output>
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      {process.env.NEXT_PUBLIC_CONVEX_URL ? <Connected /> : <Unconnected />}
    </Suspense>
  );
}
