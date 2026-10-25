import { FieldDataProvider } from "@/components/field/data";
import type { ReactNode } from "react";

/** One data source for both Field pages, so demo state carries over between them. */
export default function FieldLayout({ children }: { children: ReactNode }) {
  return <FieldDataProvider>{children}</FieldDataProvider>;
}
