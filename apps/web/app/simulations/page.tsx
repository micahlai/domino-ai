import { PageStub } from "@/components/PageStub";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Simulations" };

// Placeholder until the Timeline lane replaces this page.
export default function Page() {
  return (
    <PageStub
      label="Simulations"
      title="Every saved simulation, in one list"
      description="Each what-if you save on the timeline will be listed here, ready to reopen and compare."
      status="Arrives when the Timeline lane merges"
    >
      <Button variant="outline" asChild>
        <Link href="/case/2u/simulations">2U case simulations</Link>
      </Button>
      <Button asChild>
        <Link href="/c/kestrel">
          Open the timeline
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </PageStub>
  );
}
