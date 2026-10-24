import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function PageStub({
  label,
  title,
  description,
}: { label: string; title: string; description: string }) {
  return (
    <section className="max-w-4xl space-y-8">
      <div>
        <p className="mb-3 text-sm text-muted-foreground">{label}</p>
        <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Card className="bg-muted/50 shadow-none">
        <CardContent className="space-y-4 p-6">
          <p className="text-sm text-muted-foreground">
            This screen is ready for the next product task. Explore the component previews in the
            meantime.
          </p>
          <Button variant="outline" asChild>
            <Link href="/playground">
              Open playground
              <ArrowRight className="ml-2 size-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
