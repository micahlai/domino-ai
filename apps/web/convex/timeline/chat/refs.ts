import { makeFunctionReference } from "convex/server";
import type { ChatReceipt } from "./receipt";
type Key = { companyId: string; conversationId: string };
type Write = Key & { requestId: string; expectedRevision: number };
export const chatRefs = {
  begin: makeFunctionReference<
    "mutation",
    {
      companyId: string;
      runId: string;
      requestId: string;
      selectedWeek?: string;
      selectedItemId?: string;
    },
    ChatReceipt
  >("timeline/chat:begin"),
  send: makeFunctionReference<"mutation", Write & { text: string }, ChatReceipt>(
    "timeline/chat:send",
  ),
  reset: makeFunctionReference<"mutation", Write, ChatReceipt>("timeline/chat:reset"),
  confirm: makeFunctionReference<"mutation", Write & { reviewed: boolean }, ChatReceipt>(
    "timeline/chat:confirm",
  ),
  get: makeFunctionReference<"query", Key, ChatReceipt | null>("timeline/chat:get"),
  list: makeFunctionReference<"query", { companyId: string; runId: string }, ChatReceipt[]>(
    "timeline/chat:list",
  ),
};
