import { formatCents as formatShared } from "../../../lib/format";

/** The shared $1.2M money format with a true minus sign (U+2212), which lines up with the plus
 * sign in tabular columns. Display only. */
export const formatCents = (cents: number): string => formatShared(cents).replace(/^-/, "−");
