import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventForm } from "./EventForm";
import { ScenarioComposer } from "./ScenarioComposer";
import { type WorkspaceActions, WorkspaceView } from "./WorkspaceView";
import { composerPayload, composerReducer, freshEvent, newComposer } from "./composer";
import { buildChange, emptyEvent } from "./drafts";
import { fixtureGraph, fixtureRoot } from "./fixtures";
import { isConfirmed } from "./requests";

const firstWeek = "2026-11-02";
const selectedWeek = "2026-11-23";
const onRun = async () => ({ ok: false as const, message: "Fixture only" });

function queuedScenario() {
  let state = newComposer();
  state = composerReducer(state, { type: "kind", kind: "remove_cash", defaultDate: selectedWeek });
  state = composerReducer(state, {
    type: "edit",
    patch: { date: "2026-11-10", amount: "25,000.50", label: "Equipment" },
  });
  state = composerReducer(state, { type: "add", firstWeek, defaultDate: selectedWeek });
  return composerReducer(state, { type: "label", label: "Equipment purchase" });
}

describe("timeline scenario composition", () => {
  it("prefills a fresh cash event from chart context without changing the forecast validation minimum", () => {
    const draft = { ...freshEvent("remove_cash", selectedWeek), amount: "100", label: "Cost" };
    expect(draft.date).toBe(selectedWeek);
    expect(buildChange({ ...draft, date: "2026-11-10" }, firstWeek).ok).toBe(true);
    expect(buildChange({ ...draft, date: "2026-11-01" }, firstWeek).ok).toBe(false);
    expect(freshEvent("delay_invoice", selectedWeek).date).toBe("");
  });

  it("pins queued dates and exact reviewed payload while fresh event dates follow newer context", () => {
    let state = queuedScenario();
    state = composerReducer(state, { type: "review", checked: true });
    const reviewed = composerPayload(state);
    expect(isConfirmed(state.confirmedFor, reviewed)).toBe(true);
    const edited = composerReducer(state, {
      type: "edit",
      patch: { date: "2026-11-24", amount: "500" },
    });
    expect(edited.changes).toEqual([
      { kind: "remove_cash", date: "2026-11-10", amount: 2500050, label: "Equipment" },
    ]);
    expect(composerPayload(edited)).toBe(reviewed);
    expect(edited.draft.date).toBe("2026-11-24");
    expect(edited.confirmedFor).toBe(state.confirmedFor);
    const renamed = composerReducer(edited, { type: "label", label: "Different purchase" });
    expect(isConfirmed(renamed.confirmedFor, composerPayload(renamed))).toBe(false);
    const removed = composerReducer(state, { type: "remove", index: 0 });
    expect(isConfirmed(removed.confirmedFor, composerPayload(removed))).toBe(false);
  });

  it("retains a rejected draft and requires a new review when another event joins the queue", () => {
    let state = composerReducer(queuedScenario(), { type: "review", checked: true });
    const rejected = composerReducer(state, { type: "add", firstWeek, defaultDate: "2026-12-07" });
    expect(rejected.tried).toBe(true);
    expect(rejected.draft).toEqual(state.draft);
    expect(rejected.changes).toBe(state.changes);
    state = composerReducer(state, {
      type: "edit",
      patch: { amount: "100", label: "Second cost" },
    });
    state = composerReducer(state, { type: "add", firstWeek, defaultDate: "2026-12-07" });
    expect(state.draft.date).toBe("2026-12-07");
    expect(state.changes[1]).toMatchObject({ date: selectedWeek });
    expect(isConfirmed(state.confirmedFor, composerPayload(state))).toBe(false);
  });

  it("applies selected-item drafts explicitly without changing queued or reviewed events, and discards only explicitly", () => {
    const state = composerReducer(queuedScenario(), { type: "review", checked: true });
    const suggestion = { ...emptyEvent("delay_invoice"), invoiceId: "inv_nw_q4" };
    const picked = composerReducer(state, { type: "suggestion", draft: suggestion });
    expect(picked.draft).toEqual(suggestion);
    expect(picked.changes).toBe(state.changes);
    expect(picked.confirmedFor).toBe(state.confirmedFor);
    expect(composerReducer(picked, { type: "discard" })).toEqual(newComposer());
    const html = renderToStaticMarkup(
      <EventForm
        firstWeek={firstWeek}
        defaultDate={selectedWeek}
        suggestion={suggestion}
        invoices={[]}
        bills={[]}
        onRun={onRun}
      />,
    );
    expect(html).toContain("Replace current event with selected invoice");
    expect(html).not.toContain('value="inv_nw_q4"');
  });

  it("keeps the hidden editor mounted and uses forecast start when history is selected", () => {
    const html = renderToStaticMarkup(
      <ScenarioComposer
        selectedWeek="2026-10-19"
        firstWeek={firstWeek}
        invoices={[]}
        bills={[]}
        onRun={onRun}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
    expect(html).toContain('data-testid="event-form"');
    expect(html).toContain('dateTime="2026-11-02"');
    expect(html).not.toContain('dateTime="2026-10-19"');
  });

  it("renders exactly one editor beside the chart before week details, leaving questions and rules below", () => {
    const actions: WorkspaceActions = {
      simulate: onRun,
      reviseRules: onRun,
      ask: onRun,
      confirmProposal: onRun,
      relink: onRun,
      hrefFor: (id) => `#${id}`,
      catalogHref: "#catalog",
    };
    const html = renderToStaticMarkup(
      <WorkspaceView
        run={fixtureRoot}
        parent={null}
        graph={{ state: "ready", value: fixtureGraph }}
        questions={{ state: "ready", value: [] }}
        resultRef={{ state: "missing" }}
        actions={actions}
      />,
    );
    expect(html.match(/data-testid="event-form"/g)).toHaveLength(1);
    expect(html.indexOf('data-testid="workspace-chart"')).toBeLessThan(
      html.indexOf('data-testid="timeline-composer"'),
    );
    expect(html.indexOf('data-testid="timeline-composer"')).toBeLessThan(
      html.indexOf('data-testid="week-detail"'),
    );
    expect(html).not.toContain("Add an event</h3>");
  });
});
