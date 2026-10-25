import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  clearRequestId,
  conversationFromSearch,
  describeError,
  mayApplyCompletion,
  pendingPayload,
  requestIdFor,
  sendRequest,
} from "./session";

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};
const reject = (code: string) => new ConvexError({ code });

describe("requestIdFor", () => {
  it("keeps the id for the same intent, across a reload, and changes it for another payload", () => {
    const store = memoryStore();
    const a = requestIdFor("t1", "why?", store);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(requestIdFor("t1", "why?", store)).toBe(a);
    expect(requestIdFor("t1", "other", store)).not.toBe(a);
  });
  it("survives blocked storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    const a = requestIdFor("t2", "q", blocked);
    expect(requestIdFor("t2", "q", blocked)).toBe(a);
    clearRequestId("t2", blocked);
  });
});

describe("sendRequest", () => {
  const ok = { conversationId: "conv-1" };

  it("reuses the request id after an uncertain failure, then spends it on success", async () => {
    const store = memoryStore();
    const seen: string[] = [];
    const base = { scope: "n1", payload: "why?", stillHere: () => true, store };
    const lost = await sendRequest({
      ...base,
      call: async (id) => {
        seen.push(id);
        throw new Error("network");
      },
    });
    expect(lost.kind).toBe("failed");
    expect(lost.kind === "failed" && lost.message).toMatch(/may or may not have been recorded/);
    expect(pendingPayload("n1", store)).toBe("why?");
    const retry = await sendRequest({
      ...base,
      call: async (id) => {
        seen.push(id);
        return ok;
      },
    });
    expect(retry).toEqual({ kind: "done", conversationId: "conv-1" });
    expect(seen[1]).toBe(seen[0]);
    expect(pendingPayload("n1", store)).toBeUndefined();
  });

  it("drops the id after a definite rejection", async () => {
    const store = memoryStore();
    const out = await sendRequest({
      scope: "n2",
      payload: "",
      stillHere: () => true,
      store,
      call: async () => {
        throw reject("BUSY");
      },
    });
    expect(out).toMatchObject({ kind: "failed", message: expect.stringMatching(/still working/) });
    expect(pendingPayload("n2", store)).toBeUndefined();
  });

  it("is stale, and changes nothing visible, when the page moved on", async () => {
    const store = memoryStore();
    expect(
      await sendRequest({
        scope: "n3",
        payload: "q",
        stillHere: () => false,
        store,
        call: async () => ok,
      }),
    ).toEqual({ kind: "stale" });
    expect(
      await sendRequest({
        scope: "n4",
        payload: "q",
        stillHere: () => false,
        store,
        call: async () => {
          throw reject("CONFLICT");
        },
      }),
    ).toEqual({ kind: "stale" });
  });

  it("treats an unusable answer as retryable, not as success", async () => {
    const store = memoryStore();
    const out = await sendRequest({
      scope: "n5",
      payload: "q",
      stillHere: () => true,
      store,
      call: async () => ({ nope: true }),
    });
    expect(out.kind).toBe("failed");
    expect(pendingPayload("n5", store)).toBe("q");
  });
});

describe("compare-and-clear", () => {
  // A starts and its answer is slow, the user leaves, B (another question) starts and its answer
  // is lost, then A settles. B's saved identity must survive so B's retry is the same request.
  async function aThenLostB(
    settleA: (done: (v: unknown) => void, fail: (e: unknown) => void) => void,
  ) {
    const store = memoryStore();
    const bIds: string[] = [];
    let done: (v: unknown) => void = () => {};
    let fail: (e: unknown) => void = () => {};
    const a = sendRequest({
      scope: "x",
      payload: "Question A",
      stillHere: () => false,
      store,
      call: () =>
        new Promise((resolve, reject) => {
          done = resolve;
          fail = reject;
        }),
    });
    const b = await sendRequest({
      scope: "x",
      payload: "Question B",
      stillHere: () => true,
      store,
      call: async (id) => {
        bIds.push(id);
        throw new Error("response lost");
      },
    });
    expect(b.kind).toBe("failed");
    settleA(done, fail);
    expect(await a).toEqual({ kind: "stale" });
    const retry = await sendRequest({
      scope: "x",
      payload: "Question B",
      stillHere: () => true,
      store,
      call: async (id) => {
        bIds.push(id);
        return { conversationId: "conv-B" };
      },
    });
    return { store, bIds, retry };
  }

  it("keeps a newer pending intent when an older request succeeds late", async () => {
    const { bIds, retry, store } = await aThenLostB((done) => done({ conversationId: "conv-A" }));
    expect(bIds).toHaveLength(2);
    expect(bIds[1]).toBe(bIds[0]);
    expect(retry).toEqual({ kind: "done", conversationId: "conv-B" });
    expect(pendingPayload("x", store)).toBeUndefined();
  });

  it("keeps a newer pending intent when an older request is definitely rejected late", async () => {
    const { bIds, retry } = await aThenLostB((_, fail) => fail(reject("BUSY")));
    expect(bIds[1]).toBe(bIds[0]);
    expect(retry.kind).toBe("done");
  });

  it("still clears its own record on success and on definite rejection", async () => {
    const store = memoryStore();
    const base = { scope: "own", payload: "q", stillHere: () => false, store };
    await sendRequest({ ...base, call: async () => ({ conversationId: "c" }) });
    expect(pendingPayload("own", store)).toBeUndefined();
    await sendRequest({
      ...base,
      call: async () => {
        throw reject("NOT_FOUND");
      },
    });
    expect(pendingPayload("own", store)).toBeUndefined();
  });

  it("keeps an uncertain request across a reload and retries it with the same id", async () => {
    const store = memoryStore();
    const seen: string[] = [];
    const lost = () =>
      sendRequest({
        scope: "r",
        payload: "q",
        stillHere: () => true,
        store,
        call: async (id) => {
          seen.push(id);
          throw new Error("offline");
        },
      });
    await lost();
    await lost();
    expect(seen[1]).toBe(seen[0]);
    expect(pendingPayload("r", store)).toBe("q");
  });

  it("clearRequestId with an id leaves a different saved request alone", () => {
    const store = memoryStore();
    const id = requestIdFor("c1", "q", store);
    clearRequestId("c1", store, "someone-else");
    expect(pendingPayload("c1", store)).toBe("q");
    clearRequestId("c1", store, id);
    expect(pendingPayload("c1", store)).toBeUndefined();
  });
});

describe("navigation guard", () => {
  const here = { alive: true, pathname: "/investigate" };
  it("reads the conversation from the address", () => {
    expect(conversationFromSearch("?c=conv-1")).toBe("conv-1");
    expect(conversationFromSearch("")).toBeUndefined();
  });
  it("applies only on the same page for the same conversation", () => {
    expect(mayApplyCompletion({ ...here, search: "" })).toBe(true);
    expect(mayApplyCompletion({ ...here, search: "?c=a", originId: "a" })).toBe(true);
    expect(mayApplyCompletion({ ...here, search: "?c=b", originId: "a" })).toBe(false);
    expect(mayApplyCompletion({ ...here, search: "?c=a" })).toBe(false);
    expect(mayApplyCompletion({ ...here, alive: false, search: "" })).toBe(false);
    expect(mayApplyCompletion({ alive: true, pathname: "/historical", search: "" })).toBe(false);
  });
  it("follows the route it is mounted on, and ignores c where the path fixes the conversation", () => {
    const route = { alive: true, path: "/case/2u/simulations/a", pinned: true, originId: "a" };
    expect(mayApplyCompletion({ ...route, pathname: "/case/2u/simulations/a", search: "" })).toBe(
      true,
    );
    expect(mayApplyCompletion({ ...route, pathname: "/case/2u/simulations/b", search: "" })).toBe(
      false,
    );
    expect(mayApplyCompletion({ ...route, pathname: "/investigate", search: "" })).toBe(false);
    const workspace = { alive: true, path: "/case/2u", originId: "a" };
    expect(mayApplyCompletion({ ...workspace, pathname: "/case/2u", search: "?c=a" })).toBe(true);
    expect(mayApplyCompletion({ ...workspace, pathname: "/case/2u", search: "?c=b" })).toBe(false);
  });
});

describe("describeError", () => {
  it("never claims a lost response was not recorded", () => {
    expect(describeError(new Error("x"))).not.toMatch(/was not recorded/);
    expect(describeError(reject("LIMIT"))).toMatch(/once/);
  });
});
