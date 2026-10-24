import { CaseNav } from "@/components/case-workspace/CaseNav";
import { type ReactNode, Suspense } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  // data-style pins the Original dark tokens, like /investigate. AppShell already supplies <main>.
  return (
    <div data-style="original" className="flex h-dvh flex-col bg-background text-foreground">
      <Suspense fallback={null}>
        <CaseNav />
      </Suspense>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
