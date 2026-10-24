/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as approvals from "../approvals.js";
import type * as branches from "../branches.js";
import type * as capabilities from "../capabilities.js";
import type * as companies from "../companies.js";
import type * as connect from "../connect.js";
import type * as constraints from "../constraints.js";
import type * as dev_seedFixtures from "../dev/seedFixtures.js";
import type * as engine from "../engine.js";
import type * as eventInputs from "../eventInputs.js";
import type * as events from "../events.js";
import type * as explanations from "../explanations.js";
import type * as fixes from "../fixes.js";
import type * as grades from "../grades.js";
import type * as history from "../history.js";
import type * as lib_parse from "../lib/parse.js";
import type * as lib_readiness from "../lib/readiness.js";
import type * as lib_records from "../lib/records.js";
import type * as log from "../log.js";
import type * as models from "../models.js";
import type * as resilience from "../resilience.js";
import type * as risks from "../risks.js";
import type * as sources from "../sources.js";
import type * as week from "../week.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  approvals: typeof approvals;
  branches: typeof branches;
  capabilities: typeof capabilities;
  companies: typeof companies;
  connect: typeof connect;
  constraints: typeof constraints;
  "dev/seedFixtures": typeof dev_seedFixtures;
  engine: typeof engine;
  eventInputs: typeof eventInputs;
  events: typeof events;
  explanations: typeof explanations;
  fixes: typeof fixes;
  grades: typeof grades;
  history: typeof history;
  "lib/parse": typeof lib_parse;
  "lib/readiness": typeof lib_readiness;
  "lib/records": typeof lib_records;
  log: typeof log;
  models: typeof models;
  resilience: typeof resilience;
  risks: typeof risks;
  sources: typeof sources;
  week: typeof week;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
