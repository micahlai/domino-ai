"use client";
import { useState } from "react";
import { Button } from "../ui/button";
import { WeeklyBrief, type WeeklyBriefData } from "./LearningScreen";
import { WeeklyBriefNotice } from "./WeeklyBriefNotice";
export function LearningPreview() {
  const [brief, setBrief] = useState<WeeklyBriefData | null>(null);
  return (
    <div className="space-y-4">
      <WeeklyBrief brief={brief} />
      <Button
        variant="outline"
        onClick={() =>
          setBrief({
            week: "2026-10-26",
            at: new Date().toISOString(),
            text: "Sample notification: a completed weekly brief appears here. Review the saved forecast and its proposed fixes before making a decision.",
            evidence: [],
          })
        }
      >
        Preview weekly notification
      </Button>
      <WeeklyBriefNotice brief={brief} companyPath="/c/kestrel" />
    </div>
  );
}
