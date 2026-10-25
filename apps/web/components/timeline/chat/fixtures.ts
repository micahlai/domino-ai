import { fixtureRoot, fixtureRule } from "../workspace/fixtures";
import type { ChatReceipt } from "./api";
export const fixtureChatRun = fixtureRoot;
const at = "2026-10-25T16:00:00.000Z";
export const fixtureChat: ChatReceipt = {
  schemaVersion: 1,
  methodVersion: "timeline_chat@1",
  companyId: fixtureRoot.companyId,
  conversationId: "timeline:chat/fixture",
  runId: fixtureRoot.runId,
  inputHash: fixtureRoot.inputHash,
  constraintVersion: fixtureRoot.constraintVersion,
  revision: 1,
  status: "collecting",
  selectedWeek: null,
  selectedItemId: null,
  createdAt: at,
  updatedAt: at,
  turns: [
    {
      id: "greeting",
      role: "assistant",
      text: "What would you like to change in this timeline?",
      createdAt: at,
    },
    { id: "first", role: "user", text: "Add an expense for equipment", createdAt: at },
    {
      id: "ask-amount",
      role: "assistant",
      text: "How much is the equipment expense, in dollars?",
      createdAt: at,
    },
  ],
  proposal: null,
  linkedRunId: null,
  pendingField: "Expense amount",
};
export const fixtureReady: ChatReceipt = {
  ...fixtureChat,
  revision: 3,
  status: "ready",
  pendingField: null,
  turns: [
    ...fixtureChat.turns,
    { id: "amount", role: "user", text: "$50,000 on 2026-11-09", createdAt: at },
    {
      id: "review",
      role: "assistant",
      text: "Review the equipment expense and the full rule set below before calculating.",
      createdAt: at,
    },
  ],
  proposal: {
    label: "Equipment expense",
    changes: [{ kind: "remove_cash", amount: 5_000_000, date: "2026-11-09", label: "Equipment" }],
    constraints: [fixtureRule],
    constraintNote: "Fixture: retains the existing lender’s minimum.",
  },
};
export const fixtureSaved: ChatReceipt = {
  ...fixtureReady,
  revision: 4,
  status: "saved",
  linkedRunId: "timeline:workspace/saved-chat-fixture",
};
