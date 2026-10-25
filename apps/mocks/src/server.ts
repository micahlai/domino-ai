import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Snapshot, WorldStateSchema } from "@domino/contracts";
import { createMockHandler } from "./handler";

/**
 * Node host for the mock handler. The only place with fs, http and env.
 * Reloads the world file when its mtime or size changes, so a re-seed shows up on the next
 * request without a restart. A bad file fails requests with 503 instead of serving stale data.
 */
const port = Number(process.env.MOCKS_PORT ?? 4010);
const host = process.env.MOCKS_HOST ?? "127.0.0.1";
// Default is the repo-root data/local/world.json; an explicit path is relative to the cwd.
const worldPath = process.env.MOCKS_WORLD_PATH
  ? resolve(process.env.MOCKS_WORLD_PATH)
  : fileURLToPath(new URL("../../../data/local/world.json", import.meta.url));

let cached: { stamp: string; snapshot: Snapshot } | undefined;

async function loadSnapshot(): Promise<Snapshot> {
  const info = await stat(worldPath);
  const stamp = `${info.mtimeMs}:${info.size}`;
  if (cached?.stamp !== stamp) {
    cached = undefined;
    const world = WorldStateSchema.parse(JSON.parse(await readFile(worldPath, "utf8")));
    // Only the observable snapshot crosses into the handler.
    cached = { stamp, snapshot: world.snapshot };
  }
  return cached.snapshot;
}

const handler = createMockHandler({ apiKey: process.env.MOCKS_API_KEY, snapshot: loadSnapshot });

const server = createServer(async (req, res) => {
  let status = 500;
  try {
    const request = new Request(`http://${host}:${port}${req.url ?? "/"}`, {
      method: req.method ?? "GET",
      headers: Object.entries(req.headers).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : [],
      ),
    });
    const response = await handler(request);
    status = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.statusCode = status;
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    // Unparseable request targets never reach the handler.
    status = 400;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "bad_request", message: "Malformed request." } }));
  }
  // Log path and status only: never headers, keys or query strings.
  console.log(`${req.method} ${(req.url ?? "/").split("?")[0]} ${status}`);
});

server.listen(port, host, () => {
  console.log(`mocks on http://${host}:${port} reading ${worldPath}`);
  if (!process.env.MOCKS_API_KEY) console.log("MOCKS_API_KEY is not set: every request gets 503");
});
