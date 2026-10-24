"use client";

import { Button } from "@/components/ui/button";

export default function CompanyError({ reset }: { reset: () => void }) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-medium">Company records could not be loaded.</h1>
      <p className="text-sm text-muted-foreground">
        Check the company link and your connection, then try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
