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
import type * as connectors_nessie from "../connectors/nessie.js";
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
import type * as fieldAi from "../fieldAi.js";
import type * as fieldAnalyst from "../fieldAnalyst.js";
import type * as fieldApify from "../fieldApify.js";
import type * as fieldClock from "../fieldClock.js";
import type * as fieldCoordinator from "../fieldCoordinator.js";
import type * as fieldDashboard from "../fieldDashboard.js";
import type * as fieldFeed from "../fieldFeed.js";
import type * as fieldJobs from "../fieldJobs.js";
import type * as fieldJudge from "../fieldJudge.js";
import type * as fieldNessie from "../fieldNessie.js";
import type * as fieldSourceDetail from "../fieldSourceDetail.js";
import type * as fieldSources from "../fieldSources.js";
import type * as fieldTimeline from "../fieldTimeline.js";
import type * as fieldWebhooks from "../fieldWebhooks.js";
import type * as fixes from "../fixes.js";
import type * as grades from "../grades.js";
import type * as historical from "../historical.js";
import type * as history from "../history.js";
import type * as http from "../http.js";
import type * as investigation from "../investigation.js";
import type * as investigationCatalog from "../investigationCatalog.js";
import type * as lib_agentLog from "../lib/agentLog.js";
import type * as lib_analystScenarios from "../lib/analystScenarios.js";
import type * as lib_apify from "../lib/apify.js";
import type * as lib_clock from "../lib/clock.js";
import type * as lib_computed from "../lib/computed.js";
import type * as lib_connectionRows from "../lib/connectionRows.js";
import type * as lib_coordinatorRecord from "../lib/coordinatorRecord.js";
import type * as lib_counterparties from "../lib/counterparties.js";
import type * as lib_fieldCompanies from "../lib/fieldCompanies.js";
import type * as lib_judge from "../lib/judge.js";
import type * as lib_judgeOverlay from "../lib/judgeOverlay.js";
import type * as lib_parse from "../lib/parse.js";
import type * as lib_publish from "../lib/publish.js";
import type * as lib_records from "../lib/records.js";
import type * as lib_refs from "../lib/refs.js";
import type * as lib_storylines from "../lib/storylines.js";
import type * as lib_vendorWebhooks from "../lib/vendorWebhooks.js";
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
  connections: typeof connections;
  "connectors/catalog": typeof connectors_catalog;
  "connectors/gusto": typeof connectors_gusto;
  "connectors/hubspot": typeof connectors_hubspot;
  "connectors/inProcess": typeof connectors_inProcess;
  "connectors/nessie": typeof connectors_nessie;
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
  fieldAi: typeof fieldAi;
  fieldAnalyst: typeof fieldAnalyst;
  fieldApify: typeof fieldApify;
  fieldClock: typeof fieldClock;
  fieldCoordinator: typeof fieldCoordinator;
  fieldDashboard: typeof fieldDashboard;
  fieldFeed: typeof fieldFeed;
  fieldJobs: typeof fieldJobs;
  fieldJudge: typeof fieldJudge;
  fieldNessie: typeof fieldNessie;
  fieldSourceDetail: typeof fieldSourceDetail;
  fieldSources: typeof fieldSources;
  fieldTimeline: typeof fieldTimeline;
  fieldWebhooks: typeof fieldWebhooks;
  fixes: typeof fixes;
  grades: typeof grades;
  historical: typeof historical;
  history: typeof history;
  http: typeof http;
  investigation: typeof investigation;
  investigationCatalog: typeof investigationCatalog;
  "lib/agentLog": typeof lib_agentLog;
  "lib/analystScenarios": typeof lib_analystScenarios;
  "lib/apify": typeof lib_apify;
  "lib/clock": typeof lib_clock;
  "lib/computed": typeof lib_computed;
  "lib/connectionRows": typeof lib_connectionRows;
  "lib/coordinatorRecord": typeof lib_coordinatorRecord;
  "lib/counterparties": typeof lib_counterparties;
  "lib/fieldCompanies": typeof lib_fieldCompanies;
  "lib/judge": typeof lib_judge;
  "lib/judgeOverlay": typeof lib_judgeOverlay;
  "lib/parse": typeof lib_parse;
  "lib/publish": typeof lib_publish;
  "lib/records": typeof lib_records;
  "lib/refs": typeof lib_refs;
  "lib/storylines": typeof lib_storylines;
  "lib/vendorWebhooks": typeof lib_vendorWebhooks;
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
