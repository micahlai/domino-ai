import { defineSchema } from "convex/server";
import { fieldTables } from "./schemas/field.schema";
import { legacyTables } from "./schemas/legacy.schema";
import { timelineTables } from "./schemas/timeline.schema";

// Frozen composition. Each lane owns its fragment in ./schemas/*.schema.ts (two dots keep the
// Convex bundler from treating them as modules). Changing this file or another lane's tables
// needs a versioned checkpoint. Table names must stay disjoint across fragments.
export default defineSchema({ ...legacyTables, ...timelineTables, ...fieldTables });
