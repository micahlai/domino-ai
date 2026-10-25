import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkerChatContextSchema } from "../../../lib/worker-chat-context";
import { WorkerTimelinePlayground } from "../../field/WorkerTimelinePlayground";
import { WorkerContext } from "./WorkerContext";
import { fixtureWorkerContext } from "./workerFixture";

it("shows the exact saved Worker note, risk, cost assumptions and inspectable sources", () => {
  const html = renderToStaticMarkup(
    <WorkerContext companyId="kestrel" context={fixtureWorkerContext} />,
  );
  for (const text of [
    "From Worker",
    "A customer pays late",
    "Compare the collection timing",
    "Cost and assumptions",
    "Saved sources, changes and calculation details",
    "does not accept it",
  ])
    expect(html).toContain(text);
  expect(html).toContain("worker-fixture-run");
  expect(html).toContain("worker-fixture-suggestion");
});
it("offers the Worker actions and optional note in the provider-free playground", () => {
  const html = renderToStaticMarkup(<WorkerTimelinePlayground />);
  expect(html).toContain("Open in forecast</button>");
  expect(html).toContain("Dismiss</button>");
  expect(html).toContain("(optional)");
  expect(html).not.toContain("Accept</button>");
});
it("rejects mismatched or oversized context instead of attaching another suggestion", () => {
  expect(
    WorkerChatContextSchema.safeParse({ ...fixtureWorkerContext, snapshotVersion: 9 }).success,
  ).toBe(false);
  expect(
    WorkerChatContextSchema.safeParse({ ...fixtureWorkerContext, note: "a".repeat(501) }).success,
  ).toBe(false);
  expect(
    WorkerChatContextSchema.safeParse({
      ...fixtureWorkerContext,
      scenario: { ...fixtureWorkerContext.scenario, basis: "a".repeat(60_001) },
    }).success,
  ).toBe(false);
});
