import { ChatPlayground } from "@/components/timeline/chat/ChatPlayground";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Timeline chat playground" };
export default function Page() {
  return (
    <div className="min-w-0 space-y-6">
      <h1 className="text-3xl font-medium">Timeline chat preview</h1>
      <ChatPlayground />
    </div>
  );
}
