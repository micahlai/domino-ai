import { InvestigateWorkspace } from "@/components/investigate/InvestigateWorkspace";

export const metadata = { title: "Investigate" };

export default function Page() {
  // data-style pins the Original dark tokens whatever style the user picked elsewhere.
  return (
    <div data-style="original" className="h-dvh bg-background text-foreground">
      <InvestigateWorkspace />
    </div>
  );
}
