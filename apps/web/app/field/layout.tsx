import { ReplayGuard } from "@/components/field/ReplayGuard";
import { FieldDataProvider } from "@/components/field/data";
import type { ReactNode } from "react";

/** One data source for both Field pages, so demo state carries over between them. 2U (replayed
 * from filings, no live feed) gets a "not connected" note instead. */
export default function FieldLayout({ children }: { children: ReactNode }) {
  return (
    <ReplayGuard>
      <FieldDataProvider>{children}</FieldDataProvider>
    </ReplayGuard>
  );
}
