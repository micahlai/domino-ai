import { SelectedSimulations } from "@/components/field/SelectedSimulations";

export const metadata = { title: "Simulations" };

// Every saved Timeline run and scenario for the selected company (Timeline's catalog).
export default function Page() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-medium">Simulations</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every saved forecast and what-if for the selected company. Saved scenarios never change;
          open one to compare or add an event.
        </p>
      </div>
      <SelectedSimulations />
    </div>
  );
}
