import { FieldLiveBoundary } from "@/components/field/FieldLiveBoundary";
import type { ReactNode } from "react";

/** The selected operating feed backs Worker, map and connected tools. */
export default function FieldLayout({ children }: { children: ReactNode }) {
  return <FieldLiveBoundary>{children}</FieldLiveBoundary>;
}
