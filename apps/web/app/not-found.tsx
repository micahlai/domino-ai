import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <section className="space-y-6 p-6">
      <h1 className="text-3xl font-medium tracking-tight">We couldn’t find that page.</h1>
      <p className="text-sm text-muted-foreground">
        Open the playground to explore the available screens.
      </p>
      <Button asChild>
        <Link href="/playground">Open playground</Link>
      </Button>
    </section>
  );
}
