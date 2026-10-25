import { canonicalJson } from "@domino/contracts";
import { ConvexError } from "convex/values";
import type { WorkspaceRun } from "../workspace/api";
import { type RequestLedger, describeWriteError } from "../workspace/requests";
import {
  type BeginArgs,
  type ChatReceipt,
  type ConfirmArgs,
  type SendArgs,
  type TurnArgs,
  readChat,
} from "./api";
export type ChatCommand =
  | { kind: "begin"; selectedWeek?: string; selectedItemId?: string }
  | { kind: "send"; receipt: ChatReceipt; text: string }
  | { kind: "reset" | "confirm"; receipt: ChatReceipt };
export type ChatOutcome =
  | { ok: true; receipt: ChatReceipt }
  | { ok: false; message: string; uncertain?: boolean };
export type ChatCalls = {
  begin: (a: BeginArgs) => Promise<unknown>;
  send: (a: SendArgs) => Promise<unknown>;
  reset: (a: TurnArgs) => Promise<unknown>;
  confirm: (a: ConfirmArgs) => Promise<unknown>;
};
export async function requestChat(
  run: WorkspaceRun,
  command: ChatCommand,
  ledger: RequestLedger,
  calls: ChatCalls,
): Promise<ChatOutcome> {
  const scope = { companyId: run.companyId, runId: run.runId };
  if (command.kind !== "begin") {
    const checked = readChat(
      command.receipt,
      { ...scope, conversationId: command.receipt.conversationId },
      run,
    );
    if (
      checked.state !== "ready" ||
      checked.value.status === "saved" ||
      (command.kind === "confirm" && checked.value.status !== "ready")
    )
      return {
        ok: false,
        message: "Reopen the current conversation before changing or saving it.",
      };
  }
  const payload = JSON.stringify([scope, command]);
  const requestId = ledger.idFor(payload);
  try {
    let raw: unknown;
    if (command.kind === "begin")
      raw = await calls.begin({
        ...scope,
        requestId,
        ...(command.selectedWeek ? { selectedWeek: command.selectedWeek } : {}),
        ...(command.selectedItemId ? { selectedItemId: command.selectedItemId } : {}),
      });
    else {
      const args = {
        companyId: run.companyId,
        conversationId: command.receipt.conversationId,
        expectedRevision: command.receipt.revision,
        requestId,
      };
      raw =
        command.kind === "send"
          ? await calls.send({ ...args, text: command.text })
          : command.kind === "confirm"
            ? await calls.confirm({ ...args, reviewed: true })
            : await calls.reset(args);
    }
    const p = readChat(
      raw,
      {
        ...scope,
        ...(command.kind === "begin" ? {} : { conversationId: command.receipt.conversationId }),
      },
      run,
    );
    const expected = command.kind === "begin" ? 0 : command.receipt.revision + 1;
    if (
      p.state !== "ready" ||
      p.value.revision !== expected ||
      (command.kind === "begin" &&
        (p.value.selectedWeek !== (command.selectedWeek ?? null) ||
          p.value.selectedItemId !== (command.selectedItemId ?? null))) ||
      (command.kind !== "begin" &&
        (p.value.selectedWeek !== command.receipt.selectedWeek ||
          p.value.selectedItemId !== command.receipt.selectedItemId)) ||
      (command.kind === "reset" &&
        (p.value.status !== "collecting" || p.value.proposal !== null)) ||
      (command.kind === "send" && p.value.status === "saved") ||
      (command.kind === "confirm" &&
        (p.value.status !== "saved" ||
          canonicalJson(p.value.proposal) !== canonicalJson(command.receipt.proposal)))
    )
      return {
        ok: false,
        uncertain: true,
        message:
          "The reply could not be verified. It may have been saved. Retry the same request or reopen this conversation.",
      };
    ledger.renew(payload);
    return { ok: true, receipt: p.value };
  } catch (error) {
    return {
      ok: false,
      message: describeWriteError(error),
      uncertain: !(error instanceof ConvexError),
    };
  }
}

/** A completed write may navigate only while its original screen is still active. */
export class ChatNavigationGuard {
  private context = "";
  private active = true;
  private revision = 0;
  setContext(context: string) {
    if (context !== this.context) this.revision++;
    this.context = context;
  }
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.revision++;
  }
  capture() {
    return `${this.revision}:${this.context}`;
  }
  allows(context: string) {
    return this.active && context === this.capture();
  }
}

/** Freeze an unresolved command even when a live query has already advanced its revision. */
export class ChatWriteGuard {
  pending: ChatCommand | null = null;
  allows(command: ChatCommand): boolean {
    return this.pending === null || this.pending === command;
  }
  remember(command: ChatCommand) {
    this.pending = command;
  }
  resolve() {
    this.pending = null;
  }
}
