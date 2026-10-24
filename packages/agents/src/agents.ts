import type { Agents } from "@domino/contracts";
import { type ClaudeOptions, createClaudeClient } from "./claude";
import { type CreaoOptions, createCreaoClient } from "./creao";
import type { TransportRuntime } from "./http";
import { type RouterOptions, createAgentRouter } from "./router";

export interface AgentsOptions extends Partial<TransportRuntime>, RouterOptions {
  claude?: Omit<ClaudeOptions, keyof TransportRuntime>;
  creao?: Omit<CreaoOptions, keyof TransportRuntime>;
}

/**
 * Real transports behind the E6a router. The caller passes env explicitly (for example
 * process.env inside a Convex action); credentials are read only when a provider is called.
 */
export function createAgentRuntime(
  env: Record<string, string | undefined>,
  options: AgentsOptions = {},
) {
  const runtime = { fetch: options.fetch, now: options.now, sleep: options.sleep };
  const clients = {
    claude: createClaudeClient(env, { ...options.claude, ...runtime }),
    creao: createCreaoClient(env, { ...options.creao, ...runtime }),
  };
  return createAgentRouter(clients, env, { onAttempt: options.onAttempt });
}

export function createAgents(
  env: Record<string, string | undefined>,
  options: AgentsOptions = {},
): Agents {
  return createAgentRuntime(env, options).agents;
}
