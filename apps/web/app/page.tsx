import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export default function LandingPage() {
  return (
    <section className="mx-auto flex min-h-[calc(100vh-80px)] max-w-5xl flex-col justify-center px-6 py-24 md:px-10">
      <p className="mb-8 text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Your next move, with foresight
      </p>
      <h1 className="max-w-3xl text-5xl font-medium leading-[1.12] tracking-tight md:text-7xl">
        See cash problems before the dominoes fall.
      </h1>
      <p className="mb-10 mt-8 max-w-lg text-base leading-7 text-muted-foreground">
        Explore what could happen to your company’s cash. Try the fixes. You decide what happens
        next.
      </p>
      <div>
        <Button asChild size="lg">
          <Link href="/connect">
            Connect a company
            <ArrowRight className="ml-2 size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <p className="mt-10 text-sm text-muted-foreground">
        A person approves every action. Domino never moves money.
      </p>
    </section>
  );
}
