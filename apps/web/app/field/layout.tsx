import { ReplayGuard } from "@/components/field/ReplayGuard";
import { FieldDataProvider } from "@/components/field/data";
import type { ReactNode } from "react";

/** The selected operating feed backs Worker, map and connected tools. */
export default function FieldLayout({ children }: { children: ReactNode }) {
  return (
    <ReplayGuard>
      <FieldDataProvider>{children}</FieldDataProvider>
    </ReplayGuard>
  );
}
