import { formatDate } from "@/lib/format";
import type { ISODate } from "@domino/contracts";

export interface GradePreview {
  week: ISODate;
  errorPct: number;
}

export function LearningChart({ grades }: { grades: GradePreview[] }) {
  return grades.length ? (
    <ul className="space-y-3">
      {grades.map((grade) => (
        <li key={grade.week} className="flex justify-between gap-3 text-sm">
          <span>Week of {formatDate(grade.week)}</span>
          <span>{grade.errorPct}% forecast error</span>
        </li>
      ))}
    </ul>
  ) : (
    <div className="rounded-lg bg-muted p-6">
      <p className="text-sm font-medium">The forecast learns from each week.</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Weekly accuracy will appear after the first forecast is compared with bank records.
      </p>
    </div>
  );
}
