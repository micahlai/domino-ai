import { PageHeader } from "@/components/ui/page";
import { Clock } from "lucide-react";
import type { ReactNode } from "react";

/** A page that is planned but not built yet: the shared page header, then one quiet empty state. */
export function PageStub({
  label,
  title,
  description,
  status = "This page is not built yet.",
  children,
}: {
  label: string;
  title: string;
  description: string;
  /** One plain line on when the page arrives. */
  status?: string;
  /** Optional links to what works today. */
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <PageHeader eyebrow={label} title={title} description={description} />
      <section className="flex flex-col items-start gap-4 rounded-lg border border-dashed bg-card px-6 py-10 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Clock aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold tracking-[-0.01em]">{status}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Nothing here changes your data. Domino never moves money.
          </p>
        </div>
        {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
      </section>
    </div>
  );
}
