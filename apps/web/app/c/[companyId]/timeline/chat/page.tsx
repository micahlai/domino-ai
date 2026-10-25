import { ChatLive } from "@/components/timeline/chat/ChatLive";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Timeline chat" };
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-medium">Build a scenario together</h1>
        <p className="text-sm text-muted-foreground">
          Describe a change, answer a few questions, then review before saving.
        </p>
      </header>
      <ChatLive key={companyId} companyId={companyId} />
    </div>
  );
}
