import { ConvexError } from "convex/values";
import { z } from "zod";

// Request identity, completion guards and plain-words errors for the live investigation.

const PREFIX = "domino.investigate.request:";
const memory = new Map<string, string>();

/** Where a retry's identity lives. Storage can be blocked (private mode), so memory backs it up. */
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const browser = (): Store | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const StoredRequest = z.object({ id: z.string(), payload: z.string() });

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function saved(key: string, store: Store | undefined) {
  let raw: string | null = null;
  try {
    raw = store?.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    raw = memory.get(key) ?? null;
  }
  try {
    const parsed = raw ? StoredRequest.safeParse(JSON.parse(raw)) : undefined;
    return parsed?.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The request id for one user intent. The same intent (same scope and payload) keeps its id
 * across retries and reloads until it is cleared, so an uncertain send is never recorded twice.
 * A different payload gets a new id: the backend would reject the old one as a conflict.
 */
export function requestIdFor(scope: string, payload: string, store: Store | undefined = browser()) {
  const key = PREFIX + scope;
  const prior = saved(key, store);
  if (prior?.payload === payload) return prior.id;
  const id = randomId();
  const value = JSON.stringify({ id, payload });
  memory.set(key, value);
  try {
    store?.setItem(key, value);
  } catch {
    // Memory copy above still covers this tab.
  }
  return id;
}

/** The payload of a send whose outcome is still unconfirmed, if any. */
export function pendingPayload(scope: string, store: Store | undefined = browser()) {
  return saved(PREFIX + scope, store)?.payload;
}

/** With `onlyId`, clears only if that exact request still owns the scope: a newer intent stays. */
export function clearRequestId(
  scope: string,
  store: Store | undefined = browser(),
  onlyId?: string,
) {
  const key = PREFIX + scope;
  if (onlyId !== undefined && saved(key, store)?.id !== onlyId) return;
  memory.delete(key);
  try {
    store?.removeItem(key);
  } catch {
    // Nothing more to clear.
  }
}

/** The conversation id in the address, or undefined for a new investigation. */
export function conversationFromSearch(search: string) {
  return new URLSearchParams(search).get("c") || undefined;
}

/** A finished call may touch the page only if it is still mounted on its own route for the
 * conversation it started from (none = a new investigation). A route that fixes the conversation
 * in its path (`pinned`) has no `c` to compare. */
export function mayApplyCompletion(args: {
  alive: boolean;
  pathname: string;
  search: string;
  originId?: string;
  path?: string;
  pinned?: boolean;
}) {
  return (
    args.alive &&
    args.pathname === (args.path ?? "/investigate") &&
    (args.pinned || conversationFromSearch(args.search) === (args.originId || undefined))
  );
}

const ErrorData = z.object({ code: z.string() });
const CODE_TEXT: Record<string, string> = {
  INVALID_REQUEST: "That question could not be used. Keep it to 1 to 1000 characters.",
  CONFLICT: "That request was already used for something else. Reload the page and try again.",
  NOT_FOUND: "That investigation was not found.",
  BUSY: "Domino is still working on an earlier step. Wait for it to finish.",
  NOT_READY: "There is no saved forecast yet, so this cannot run.",
  LIMIT: "This investigation already did that. Each can be used once.",
};

/** A server answer that definitely rejected the request: the saved request id can be dropped. */
export function isDefinite(error: unknown): boolean {
  return error instanceof ConvexError && ErrorData.safeParse(error.data).success;
}

/** Plain words. A lost response may still have been applied, so never say it was not. */
export function describeError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = ErrorData.safeParse(error.data);
    const text = data.success ? CODE_TEXT[data.data.code] : undefined;
    if (text) return text;
  }
  return "Could not confirm the result. It may or may not have been recorded. Check the connection and try again: the retry uses the same request, so it will not be saved twice.";
}

export class UnusableResult extends Error {}

const Receipt = z.object({ conversationId: z.string().min(1) });
/** Boundary parse of a mutation result. Throws so the caller shows a retryable error. */
export function receiptConversation(result: unknown) {
  const parsed = Receipt.safeParse(result);
  if (!parsed.success) throw new UnusableResult();
  return parsed.data.conversationId;
}

export type Outcome =
  | { kind: "done"; conversationId: string }
  | { kind: "failed"; message: string }
  | { kind: "stale" };

/**
 * One user intent, once. The request id is stable until the server answers definitely, so a retry
 * or a reload after an uncertain send repeats the same request. A page that moved on in the
 * meantime gets "stale" and must change nothing.
 */
export async function sendRequest(args: {
  scope: string;
  payload: string;
  call: (requestId: string) => Promise<unknown>;
  stillHere: () => boolean;
  store?: Store;
}): Promise<Outcome> {
  const { scope, payload, call, stillHere, store = browser() } = args;
  const requestId = requestIdFor(scope, payload, store);
  try {
    const conversationId = receiptConversation(await call(requestId));
    // Recorded: this request is spent whether or not this page is still showing it. Only its own
    // record is dropped: a late settle must not erase a newer, possibly unconfirmed, intent.
    clearRequestId(scope, store, requestId);
    return stillHere() ? { kind: "done", conversationId } : { kind: "stale" };
  } catch (error) {
    // A definite answer rejected the request; anything else may have been applied, so keep its id.
    if (isDefinite(error)) clearRequestId(scope, store, requestId);
    return stillHere() ? { kind: "failed", message: describeError(error) } : { kind: "stale" };
  }
}
