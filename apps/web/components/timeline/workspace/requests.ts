import { ConvexError } from "convex/values";
import { z } from "zod";

/**
 * One request id per exact payload. A retry after an uncertain answer (lost connection, timeout)
 * reuses the id, so the service can return the first result instead of saving twice. Only an
 * explicit "try again" after a definite failed receipt asks for a fresh id.
 */
export class RequestLedger {
  private ids = new Map<string, string>();
  constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}

  idFor(payload: string): string {
    const known = this.ids.get(payload);
    if (known) return known;
    const id = this.newId();
    this.ids.set(payload, id);
    return id;
  }

  /** A definite terminal failure: the next attempt is a new request. */
  renew(payload: string): string {
    this.ids.delete(payload);
    return this.idFor(payload);
  }
}

/**
 * The person's confirmation applies to one exact payload. Changing any input makes the stored
 * confirmation stale, so it reads as unconfirmed without an effect to reset it.
 */
export function isConfirmed(confirmedFor: string | null, payload: string | null): boolean {
  return payload !== null && confirmedFor === payload;
}

export type Outcome = { ok: true; runId: string } | { ok: false; message: string };

const ErrorData = z.union([z.string(), z.object({ message: z.string() }).passthrough()]);

/** Plain words for a failed write. A lost answer may still have been saved, so never deny it. */
export function describeWriteError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = ErrorData.safeParse(error.data);
    if (data.success)
      return `Not saved: ${typeof data.data === "string" ? data.data : data.data.message}`;
  }
  return "Could not confirm the result. It may or may not have been saved. Try again: the retry repeats the same request, so it will not be saved twice.";
}

export const UNUSABLE_ANSWER =
  "The service answered, but the answer could not be used. It may have been saved; check the saved scenarios.";
