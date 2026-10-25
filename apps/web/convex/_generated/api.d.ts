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
import type * as constraints from "../constraints.js";
import type * as dev_seedComputed from "../dev/seedComputed.js";
import type * as dev_seedFixtures from "../dev/seedFixtures.js";
import type * as engine from "../engine.js";
import type * as events from "../events.js";
import type * as explanations from "../explanations.js";
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
import type * as timeline_analysis from "../timeline/analysis.js";
import type * as timeline_analysis_compute from "../timeline/analysis/compute.js";
import type * as timeline_analysis_receipt from "../timeline/analysis/receipt.js";
import type * as timeline_analysis_refs from "../timeline/analysis/refs.js";
import type * as timeline_analysis_table from "../timeline/analysis/table.js";
import type * as timeline_baselines from "../timeline/baselines.js";
import type * as timeline_chat from "../timeline/chat.js";
import type * as timeline_chat_draft from "../timeline/chat/draft.js";
import type * as timeline_chat_receipt from "../timeline/chat/receipt.js";
import type * as timeline_chat_refs from "../timeline/chat/refs.js";
import type * as timeline_chat_source from "../timeline/chat/source.js";
import type * as timeline_chat_table from "../timeline/chat/table.js";
import type * as timeline_output from "../timeline/output.js";
import type * as timeline_output_project from "../timeline/output/project.js";
import type * as timeline_questions from "../timeline/questions.js";
import type * as timeline_questions_context from "../timeline/questions/context.js";
import type * as timeline_questions_grammar from "../timeline/questions/grammar.js";
import type * as timeline_questions_intent from "../timeline/questions/intent.js";
import type * as timeline_questions_meaning from "../timeline/questions/meaning.js";
import type * as timeline_questions_parse from "../timeline/questions/parse.js";
import type * as timeline_questions_provider from "../timeline/questions/provider.js";
import type * as timeline_questions_receipt from "../timeline/questions/receipt.js";
import type * as timeline_questions_resolve from "../timeline/questions/resolve.js";
import type * as timeline_questions_table from "../timeline/questions/table.js";
import type * as timeline_refs from "../timeline/refs.js";
import type * as timeline_workspace from "../timeline/workspace.js";
import type * as timeline_workspaceInput from "../timeline/workspaceInput.js";
import type * as timeline_workspaceRefs from "../timeline/workspaceRefs.js";
import type * as timeline_workspaceRules from "../timeline/workspaceRules.js";
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
  constraints: typeof constraints;
  "dev/seedComputed": typeof dev_seedComputed;
  "dev/seedFixtures": typeof dev_seedFixtures;
  engine: typeof engine;
  events: typeof events;
  explanations: typeof explanations;
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
  "timeline/analysis": typeof timeline_analysis;
  "timeline/analysis/compute": typeof timeline_analysis_compute;
  "timeline/analysis/receipt": typeof timeline_analysis_receipt;
  "timeline/analysis/refs": typeof timeline_analysis_refs;
  "timeline/analysis/table": typeof timeline_analysis_table;
  "timeline/baselines": typeof timeline_baselines;
  "timeline/chat": typeof timeline_chat;
  "timeline/chat/draft": typeof timeline_chat_draft;
  "timeline/chat/receipt": typeof timeline_chat_receipt;
  "timeline/chat/refs": typeof timeline_chat_refs;
  "timeline/chat/source": typeof timeline_chat_source;
  "timeline/chat/table": typeof timeline_chat_table;
  "timeline/output": typeof timeline_output;
  "timeline/output/project": typeof timeline_output_project;
  "timeline/questions": typeof timeline_questions;
  "timeline/questions/context": typeof timeline_questions_context;
  "timeline/questions/grammar": typeof timeline_questions_grammar;
  "timeline/questions/intent": typeof timeline_questions_intent;
  "timeline/questions/meaning": typeof timeline_questions_meaning;
  "timeline/questions/parse": typeof timeline_questions_parse;
  "timeline/questions/provider": typeof timeline_questions_provider;
  "timeline/questions/receipt": typeof timeline_questions_receipt;
  "timeline/questions/resolve": typeof timeline_questions_resolve;
  "timeline/questions/table": typeof timeline_questions_table;
  "timeline/refs": typeof timeline_refs;
  "timeline/workspace": typeof timeline_workspace;
  "timeline/workspaceInput": typeof timeline_workspaceInput;
  "timeline/workspaceRefs": typeof timeline_workspaceRefs;
  "timeline/workspaceRules": typeof timeline_workspaceRules;
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
