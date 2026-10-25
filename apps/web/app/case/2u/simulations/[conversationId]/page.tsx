import { SimulationDetail } from "@/components/case-workspace/SimulationDetail";

export const metadata = { title: "Simulation · 2U" };

export default async function Page({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <SimulationDetail conversationId={conversationId} />;
}
