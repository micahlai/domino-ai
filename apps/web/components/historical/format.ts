import { type ISODate, ISODateSchema } from "@domino/contracts";

const reportDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Historical dates cross years, so unlike lib/format's formatDate the year is always shown. */
export function formatReportDate(iso: ISODate): string {
  ISODateSchema.parse(iso);
  return reportDate.format(new Date(`${iso}T00:00:00.000Z`));
}
