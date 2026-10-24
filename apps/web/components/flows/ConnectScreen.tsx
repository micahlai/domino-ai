"use client";
import { type CompanyProfile, CompanyProfileSchema } from "@domino/contracts";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ConnectChecklist, type SourcePreview } from "../ConnectChecklist";
import { resolveCompanyId } from "../company/routeId";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

export function ConnectForm({
  onCreate,
}: { onCreate?: (name: string, profile: CompanyProfile) => Promise<void> }) {
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<CompanyProfile>("kestrel");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!onCreate || pending) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > 200) {
          setError("Enter a company name between 1 and 200 characters.");
          return;
        }
        setPending(true);
        setError("");
        try {
          await onCreate(trimmed, CompanyProfileSchema.parse(profile));
        } catch {
          setError("Could not create the company. Your form is still here; please try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="block text-sm">
        Company name
        <input
          required
          maxLength={200}
          autoComplete="organization"
          className="mt-2 min-h-11 w-full rounded-md border bg-background px-3"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Mock company profile
        <select
          className="mt-2 min-h-11 w-full rounded-md border bg-background px-3"
          value={profile}
          onChange={(event) => setProfile(CompanyProfileSchema.parse(event.target.value))}
        >
          <option value="kestrel">Kestrel — B2B software</option>
          <option value="tally">Tally</option>
          <option value="orbit">Orbit</option>
        </select>
      </label>
      <p className="text-sm leading-6 text-muted-foreground">
        Use mock billing, customer and payroll records, plus the demo bank. You review any records
        that need attention.
      </p>
      <Button type="submit" disabled={!onCreate || pending}>
        {pending ? "Creating company…" : "Create company"}
      </Button>
      {!onCreate ? (
        <p className="text-sm text-muted-foreground">
          Company creation is not connected in this preview.{" "}
          <Link className="text-primary underline" href="/c/kestrel">
            Explore the sample company
          </Link>
          .
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ConnectionProgress({
  name,
  sources,
  ready,
  processingReady,
}: { name: string; sources: SourcePreview[]; ready: boolean; processingReady: boolean }) {
  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="text-3xl font-medium">
        {ready ? `${name} is ready.` : `Preparing ${name}’s records.`}
      </h1>
      <p className="text-sm text-muted-foreground">
        {ready
          ? "Your records are ready to review. Opening the cash forecast…"
          : !processingReady
            ? "The company was created. Source processing is not available yet; saved progress will remain here when you return."
            : "Reading the connected records and checking them against the bank. This view updates as each source is processed."}
      </p>
      {sources.length ? (
        <ConnectChecklist sources={sources} />
      ) : (
        <output className="block rounded-lg bg-muted p-5 text-sm text-muted-foreground">
          Waiting for the first source update.
        </output>
      )}
    </section>
  );
}

const sourceLabels: Record<string, string> = {
  stripe: "Billing records",
  nessie: "Demo bank",
  crm: "Customer records",
  ramp: "Card spending",
  books: "Books",
  payroll: "Payroll",
  document: "Company documents",
  learned: "Learned payment patterns",
};
export function LiveConnection({ companyId }: { companyId: Id<"companies"> }) {
  const company = useQuery(api.companies.get, { companyId });
  const sources = useQuery(api.sources.list, { companyId });
  const capabilities = useQuery(api.capabilities.get, {});
  const router = useRouter();
  useEffect(() => {
    if (company?.status === "ready") router.replace(`/c/${companyId}`);
  }, [company?.status, companyId, router]);
  if (company === undefined || sources === undefined || capabilities === undefined)
    return (
      <div aria-busy="true" className="space-y-4">
        <p className="text-sm text-muted-foreground">Loading connection progress…</p>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (!company)
    return (
      <p className="text-sm">
        This company could not be found.{" "}
        <Link className="text-primary underline" href="/connect">
          Create a company
        </Link>
        .
      </p>
    );
  return (
    <ConnectionProgress
      name={company.name}
      ready={company.status === "ready"}
      processingReady={capabilities.connect}
      sources={sources.map((source) => ({
        kind: source.kind,
        label: sourceLabels[source.kind] ?? source.kind,
        step: source.step,
        status:
          source.tieOut === "ok"
            ? "checked"
            : source.tieOut === "needs_review"
              ? "needs_review"
              : source.mappings.length
                ? "learned"
                : "found",
      }))}
    />
  );
}

function LiveConnectForm() {
  const create = useMutation(api.companies.create);
  const router = useRouter();
  return (
    <ConnectForm
      onCreate={async (name, profile) => {
        const id = await create({ name, profile });
        router.push(`/connect?companyId=${id}`);
      }}
    />
  );
}
export function ConnectScreen({ initialId }: { initialId?: string }) {
  if (initialId) {
    const id = resolveCompanyId(initialId);
    return id.success && process.env.NEXT_PUBLIC_CONVEX_URL ? (
      <LiveConnection companyId={id.data} />
    ) : (
      <p className="text-sm">
        This connection link is not valid.{" "}
        <Link href="/connect" className="text-primary underline">
          Start a new connection
        </Link>
        .
      </p>
    );
  }
  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-medium">Bring your company’s cash into focus.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Create a company, then follow each source as Domino reads and checks its records.
        </p>
      </div>
      {process.env.NEXT_PUBLIC_CONVEX_URL ? <LiveConnectForm /> : <ConnectForm />}
    </div>
  );
}
