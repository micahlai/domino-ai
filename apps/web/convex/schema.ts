import { defineSchema } from "convex/server";
import { fieldTables } from "./schemas/field.schema";
import { timelineTables } from "./schemas/timeline.schema";

// Frozen composition. Each lane owns its fragment in ./schemas/*.schema.ts (two dots keep the
// Convex bundler from treating them as modules). Changing this file or another lane's tables
// needs a versioned checkpoint. Table names must stay disjoint across fragments.
// P0 v2: the 14 legacy tables moved into the lane fragments; shared validators stay in
// ./schemas/legacy.schema.ts. schema.export() is unchanged per table (tables compared sorted).
export default defineSchema({ ...timelineTables, ...fieldTables });
