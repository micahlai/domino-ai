import { SelectedSimulations } from "@/components/field/SelectedSimulations";
import { PageHeader } from "@/components/ui/page";

export const metadata = { title: "Simulations" };

// Every saved Timeline run and scenario for the selected company (Timeline's catalog).
export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulations"
        description="Every saved forecast and what-if for the selected company. Saved scenarios never change; open one to compare or add an event."
      />
      <SelectedSimulations />
    </div>
  );
}
