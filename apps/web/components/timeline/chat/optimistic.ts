import type { ChatReceipt } from "./api";

export type OptimisticSend = {
  id: string;
  text: string;
  conversationId: string | null;
  afterUserCount: number;
  uncertain: boolean;
};
export function queuedMessage(
  id: string,
  text: string,
  receipt: ChatReceipt | null,
): OptimisticSend {
  return {
    id,
    text,
    conversationId: receipt?.conversationId ?? null,
    afterUserCount: receipt?.turns.filter((turn) => turn.role === "user").length ?? 0,
    uncertain: false,
  };
}
export function bindMessage(message: OptimisticSend, receipt: ChatReceipt): OptimisticSend {
  return { ...message, conversationId: receipt.conversationId };
}
/** Older identical messages are not acknowledgements of this send. */
export function messageAcknowledged(message: OptimisticSend, receipt: ChatReceipt | null): boolean {
  return (
    receipt?.conversationId === message.conversationId &&
    receipt.turns
      .filter((turn) => turn.role === "user")
      .slice(message.afterUserCount)
      .some((turn) => turn.text === message.text)
  );
}
export function visibleMessage(
  message: OptimisticSend | null,
  receipt: ChatReceipt | null,
): OptimisticSend | null {
  if (!message || messageAcknowledged(message, receipt)) return null;
  if (receipt && message.conversationId && message.conversationId !== receipt.conversationId)
    return null;
  return message;
}
