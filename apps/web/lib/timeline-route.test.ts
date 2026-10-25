import { describe, expect, it } from "vitest";
import { analysisHref } from "../components/timeline/analysis/links";
import { chatHref } from "../components/timeline/chat/api";
import { workspaceHref } from "../components/timeline/workspace/api";
import { decodeTimelineCompanyId } from "./timeline-route";

describe("Timeline route company id", () => {
  it("turns the encoded operating route segment into the backend id and encodes links once", () => {
    const id = decodeTimelineCompanyId("operating%2F2u%2Fbaseline");
    expect(id).toBe("operating/2u/baseline");
    expect(workspaceHref(id)).toBe("/c/operating%2F2u%2Fbaseline/timeline");
    expect(analysisHref(id, "run1")).toBe(
      "/c/operating%2F2u%2Fbaseline/timeline/analysis?runId=run1",
    );
    expect(chatHref(id, "run1")).toBe(
      "/c/operating%2F2u%2Fbaseline/timeline?runId=run1#timeline-chat",
    );
    expect(decodeTimelineCompanyId(id)).toBe(id);
  });

  it("leaves legacy and malformed ids intact", () => {
    expect(decodeTimelineCompanyId("kestrel")).toBe("kestrel");
    expect(decodeTimelineCompanyId("bad%ZZ")).toBe("bad%ZZ");
  });
});
