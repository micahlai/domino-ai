import { query } from "./_generated/server";
import { actionReadiness } from "./lib/readiness";

export const get = query({ args: {}, handler: () => actionReadiness });
