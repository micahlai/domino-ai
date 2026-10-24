"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import type { WeeklyBriefData } from "./LearningScreen";

export function WeeklyBriefNotice({
  brief,
  companyPath,
}: { brief: WeeklyBriefData | null | undefined; companyPath: string }) {
  const seen = useRef<string | null | undefined>(undefined);
  const [notice, setNotice] = useState<WeeklyBriefData>();
  useEffect(() => {
    if (brief === undefined) return;
    const key = brief ? `${brief.week}:${brief.at}` : null;
    if (seen.current !== undefined && key !== seen.current && brief) setNotice(brief);
    seen.current = key;
  }, [brief]);
  if (!notice) return null;
  return (
    <aside
      aria-label="Weekly update"
      className="fixed bottom-4 right-4 z-50 max-h-[60vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border bg-card p-5 shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium">Your weekly brief is ready.</p>
        <Button size="sm" variant="ghost" className="min-h-9" onClick={() => setNotice(undefined)}>
          Dismiss
        </Button>
      </div>
      <output className="mt-3 block break-words text-sm leading-6 text-muted-foreground">
        {notice.text.length > 320 ? `${notice.text.slice(0, 320)}…` : notice.text}
      </output>
      <Link
        className="mt-3 inline-block min-h-9 text-sm text-primary underline"
        href={`${companyPath}/learning`}
      >
        Read the weekly brief
      </Link>
    </aside>
  );
}
