// Shared validators for the weekly tables (frozen). P0 v2 moved the 14 original Domino tables
// into the lane fragments (Field: companies, sources, snapshots, models, constraints, approvals,
// log; Timeline: risks, branches, fixes, resilience, history, grades, explanations). Only
// validators both lanes use stay here. Root ../schema.ts composition is frozen: change it, or
// any table owned by another lane, only through a versioned checkpoint reviewed by both lanes.
import { v } from "convex/values";

/** Every weekly table keys on a Field-owned companies document. */
export const companyId = v.id("companies");
