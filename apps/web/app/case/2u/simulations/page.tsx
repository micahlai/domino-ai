import { SimulationList } from "@/components/case-workspace/SimulationList";
import { Suspense } from "react";

export const metadata = { title: "Simulations · 2U" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SimulationList />
    </Suspense>
  );
}
