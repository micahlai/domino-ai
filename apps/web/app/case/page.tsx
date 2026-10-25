import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

// The earlier home page: an intro to the public 2U case study, kept reachable from the shell.
export const metadata = { title: "2U case study" };

const steps = [
  "Ask what happened to 2U's cash and let Domino investigate.",
  "Inspect the company data, with the source and publication date for each fact.",
  "View the forecast saved from what was public at the cutoff date.",
  "Reveal what 2U reported next and compare it with that forecast.",
  "Try a different decision and see its cost and assumptions.",
];

export default function CaseStudyIntroPage() {
  return (
    <section className="mx-auto flex max-w-5xl flex-col justify-center py-8 md:py-16">
      <p className="mb-6 text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Public case study: 2U, late 2023
      </p>
      <h1 className="max-w-3xl text-4xl font-medium leading-[1.12] tracking-tight md:text-6xl">
        Investigate a company's cash, then test what could have gone differently.
      </h1>
      <ol className="mb-10 mt-8 max-w-xl list-decimal space-y-2 pl-5 text-base leading-7 text-muted-foreground">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/case/2u">
            Start investigating
            <ArrowRight className="ml-2 size-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/historical">View the cash chart</Link>
        </Button>
      </div>
      <p className="mt-10 max-w-xl text-sm leading-6 text-muted-foreground">
        This uses public 2U filings only and looks back; it is not a prediction made at the time.
        Connecting your own company is not available yet. A person approves every action. Domino
        never moves money.
      </p>
    </section>
  );
}
