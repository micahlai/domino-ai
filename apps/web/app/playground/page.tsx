import { Playground } from "@/components/Playground";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Component playground" };

export default function PlaygroundPage() {
  return <Playground />;
}
