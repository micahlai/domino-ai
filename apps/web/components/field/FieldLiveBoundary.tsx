"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ReplayGuard } from "./ReplayGuard";
import { FieldDataProvider } from "./data";

/** An exact saved trace must not prepare or relabel the currently selected live company. */
export function FieldLiveBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/field/analysis" || pathname.startsWith("/field/analysis/")) return children;
  return (
    <ReplayGuard>
      <FieldDataProvider>{children}</FieldDataProvider>
    </ReplayGuard>
  );
}
