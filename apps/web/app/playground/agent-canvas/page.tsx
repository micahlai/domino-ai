import type { Metadata } from "next";
import { AgentCanvasFixtures } from "./AgentCanvasFixtures";

export const metadata: Metadata = { title: "Agent canvas fixtures" };

export default function Page() {
  return (
    <div data-style="original" className="flex h-dvh flex-col bg-background text-foreground">
      <AgentCanvasFixtures />
    </div>
  );
}
