import { readFileSync, writeFileSync } from "node:fs";
import type { Fetcher, ToolId } from "../../connectors/types";

/**
 * Recorded mock responses: a recording fetcher saves every page a connector requested, and a
 * replay fetcher serves exactly those pages back, so translator tests run on fixed vendor JSON.
 */
export interface Recorded {
  path: string;
  status: number;
  link: string | null;
  body: unknown;
}

const file = (tool: ToolId) => new URL(`./fixtures/${tool}.json`, import.meta.url);

export function recorder(inner: Fetcher): { fetcher: Fetcher; calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    fetcher: async (path) => {
      const res = await inner(path);
      const body: unknown = await res.clone().json();
      calls.push({ path, status: res.status, link: res.headers.get("link"), body });
      return res;
    },
  };
}

export const saveFixture = (tool: ToolId, calls: Recorded[]) =>
  writeFileSync(file(tool), `${JSON.stringify(calls, null, 2)}\n`);

export const loadFixture = (tool: ToolId): Recorded[] =>
  JSON.parse(readFileSync(file(tool), "utf8")) as Recorded[];

export function replay(calls: Recorded[]): Fetcher {
  return async (path) => {
    const hit = calls.find((c) => c.path === path);
    if (!hit) throw new Error(`no recorded response for ${path}`);
    return new Response(JSON.stringify(hit.body), {
      status: hit.status,
      headers: { "content-type": "application/json", ...(hit.link && { link: hit.link }) },
    });
  };
}
