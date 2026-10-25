import { chatHref } from "@/components/timeline/chat/api";
import { workspaceHref } from "@/components/timeline/workspace/api";
import { decodeTimelineCompanyId } from "@/lib/timeline-route";
import { redirect } from "next/navigation";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const companyId = decodeTimelineCompanyId((await params).companyId);
  const search = await searchParams;
  const value = (name: string) => (typeof search[name] === "string" ? search[name] : undefined);
  const runId = value("runId");
  redirect(
    runId
      ? chatHref(
          companyId,
          runId,
          value("conversationId"),
          value("selectedWeek"),
          value("selectedItemId"),
        )
      : workspaceHref(companyId),
  );
}
