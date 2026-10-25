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
import type * as companies from "../companies.js";
import type * as computed from "../computed.js";
import type * as connect from "../connect.js";
import type * as connections from "../connections.js";
import type * as connectors_catalog from "../connectors/catalog.js";
import type * as connectors_gusto from "../connectors/gusto.js";
import type * as connectors_hubspot from "../connectors/hubspot.js";
import type * as connectors_inProcess from "../connectors/inProcess.js";
import type * as connectors_plaid from "../connectors/plaid.js";
import type * as connectors_pullAll from "../connectors/pullAll.js";
import type * as connectors_qbo from "../connectors/qbo.js";
import type * as connectors_ramp from "../connectors/ramp.js";
import type * as connectors_stripe from "../connectors/stripe.js";
import type * as connectors_types from "../connectors/types.js";
import type * as connectors_vendorHttp from "../connectors/vendorHttp.js";
import type * as constraints from "../constraints.js";
import type * as dev_seedComputed from "../dev/seedComputed.js";
import type * as dev_seedFixtures from "../dev/seedFixtures.js";
import type * as engine from "../engine.js";
import type * as events from "../events.js";
import type * as explanations from "../explanations.js";
import type * as field from "../field.js";
import type * as fieldFeed from "../fieldFeed.js";
import type * as fieldJobs from "../fieldJobs.js";
import type * as fieldSources from "../fieldSources.js";
import type * as fixes from "../fixes.js";
import type * as grades from "../grades.js";
import type * as historical from "../historical.js";
import type * as history from "../history.js";
import type * as investigation from "../investigation.js";
import type * as investigationCatalog from "../investigationCatalog.js";
import type * as lib_computed from "../lib/computed.js";
import type * as lib_parse from "../lib/parse.js";
import type * as lib_publish from "../lib/publish.js";
import type * as lib_records from "../lib/records.js";
import type * as lib_refs from "../lib/refs.js";
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
  companies: typeof companies;
  computed: typeof computed;
  connect: typeof connect;
  connections: typeof connections;
  "connectors/catalog": typeof connectors_catalog;
  "connectors/gusto": typeof connectors_gusto;
  "connectors/hubspot": typeof connectors_hubspot;
  "connectors/inProcess": typeof connectors_inProcess;
  "connectors/plaid": typeof connectors_plaid;
  "connectors/pullAll": typeof connectors_pullAll;
  "connectors/qbo": typeof connectors_qbo;
  "connectors/ramp": typeof connectors_ramp;
  "connectors/stripe": typeof connectors_stripe;
  "connectors/types": typeof connectors_types;
  "connectors/vendorHttp": typeof connectors_vendorHttp;
  constraints: typeof constraints;
  "dev/seedComputed": typeof dev_seedComputed;
  "dev/seedFixtures": typeof dev_seedFixtures;
  engine: typeof engine;
  events: typeof events;
  explanations: typeof explanations;
  field: typeof field;
  fieldFeed: typeof fieldFeed;
  fieldJobs: typeof fieldJobs;
  fieldSources: typeof fieldSources;
  fixes: typeof fixes;
  grades: typeof grades;
  historical: typeof historical;
  history: typeof history;
  investigation: typeof investigation;
  investigationCatalog: typeof investigationCatalog;
  "lib/computed": typeof lib_computed;
  "lib/parse": typeof lib_parse;
  "lib/publish": typeof lib_publish;
  "lib/records": typeof lib_records;
  "lib/refs": typeof lib_refs;
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
