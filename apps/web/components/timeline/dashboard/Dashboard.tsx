import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

// Placeholder. The Timeline lane owns this file and replaces it with the real dashboard;
// the shell only renders it from app/page.tsx.
export function Dashboard() {
  return (
    <section className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Dashboard</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
          Cash health for the next 13 weeks appears here.
        </p>
      </div>
      <Link
        href="/field"
        className="group block max-w-xl rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Card className="transition-colors group-hover:border-primary">
          <CardContent className="flex items-center justify-between gap-6 p-6">
            <div>
              <p className="text-lg font-medium">Open the worker</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Review flagged items, start an analysis or try an event.
              </p>
            </div>
            <ArrowRight
              className="size-5 shrink-0 text-primary transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </CardContent>
        </Card>
      </Link>
    </section>
  );
}
