import type { TransportRuntime } from "./http";

/** Offline doubles for transport tests. Nothing here touches the network or real time. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  redirect: RequestRedirect | undefined;
  signal: AbortSignal | undefined;
}

export type Handler = (call: RecordedCall, index: number) => Response | Promise<Response>;

export function fakeRuntime(handler: Handler) {
  const calls: RecordedCall[] = [];
  const sleeps: number[] = [];
  let time = 0;
  const runtime: TransportRuntime = {
    fetch: async (url, init) => {
      const call: RecordedCall = {
        url,
        method: init.method ?? "GET",
        headers: { ...(init.headers as Record<string, string> | undefined) },
        body: typeof init.body === "string" ? init.body : undefined,
        redirect: init.redirect,
        signal: init.signal ?? undefined,
      };
      calls.push(call);
      return handler(call, calls.length - 1);
    },
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
  };
  const advance = (ms: number) => {
    time += ms;
  };
  return { runtime, calls, sleeps, advance };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });

/** A body that streams without content-length, so the byte cap must stop it mid-read. */
export function streamed(text: string, chunkSize = 1024): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.byteLength) return controller.close();
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      },
    }),
    { status: 200 },
  );
}

/** Never resolves on its own; rejects when the transport aborts the request. */
export function hangUntilAborted(call: RecordedCall): Promise<Response> {
  return new Promise((_, reject) => {
    call.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

export async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
}
