import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatCents } from "../../lib/format";
import { VENDORS } from "../icons/vendors";
import { type Focusable, panelFocus } from "./BrainMapFocus";
import { demoSourceDetail, toolOfVendor } from "./BrainMapSourceData";
import { SourceHover, SourcePanel, connectionState } from "./BrainMapSourcePanel";
import { buildBrainGraph } from "./graph";

// parts.tsx pulls in the shadcn Switch, which imports through the app's "@/" alias that vitest
// does not resolve; these tests never render it.
vi.mock("../ui/switch", () => ({ Switch: () => null }));

const NOW = Date.parse("2026-10-30T15:00:00.000Z");
const READ_AT = "2026-10-30T12:00:00.000Z";

const panel = (vendor: string, extra: Record<string, unknown> = {}) => {
  const tool = toolOfVendor(vendor as never);
  if (!tool) throw new Error(`${vendor} is not a connector`);
  return renderToStaticMarkup(
    createElement(SourcePanel, {
      detail: demoSourceDetail(tool, READ_AT),
      vendor,
      title: VENDORS[tool].name,
      now: NOW,
      demo: true,
      onClose: () => {},
      ...extra,
    }),
  );
};

describe("source panel", () => {
  it("maps every built-in connector source on the map to its tool", () => {
    const sources = buildBrainGraph([]).nodes.filter((n) => n.kind === "source");
    expect(sources.map((n) => toolOfVendor(n.vendor)).sort()).toEqual(
      ["gusto", "hubspot", "plaid", "qbo", "ramp", "stripe"].sort(),
    );
    expect(toolOfVendor("capitalone")).toBeUndefined();
  });

  it("shows Stripe's logo and brand stripe, its lists and the records it read", () => {
    const html = panel("stripe");
    const d = demoSourceDetail("stripe", READ_AT);
    expect(html).toContain('aria-label="Stripe logo"');
    // Brand color only as a stripe and a light tint, never as text color.
    expect(html).toContain(`border-top-color:${VENDORS.stripe.color}`);
    expect(html).toContain(`background-color:${VENDORS.stripe.color}14`);
    expect(html).not.toMatch(new RegExp(`(^|[^-])color:${VENDORS.stripe.color}`, "i"));
    expect(html).toContain("Connected");
    expect(html).toContain("3 h ago");
    for (const label of ["Customers", "Invoices", "Subscriptions"]) expect(html).toContain(label);
    expect(d.recent.length).toBeGreaterThanOrEqual(5);
    for (const r of d.recent) {
      expect(html).toContain(r.counterparty);
      if (r.amount !== null) expect(html).toContain(formatCents(r.amount));
    }
    expect(html).toContain("Read 2,111 records from Stripe in 22 pages");
    expect(html).toContain("/v1/invoices");
  });

  it("shows QuickBooks with its own logo and color, and only the bills it is the record for", () => {
    const html = panel("qbo");
    expect(html).toContain('aria-label="QuickBooks logo"');
    expect(html).toContain(`border-top-color:${VENDORS.qbo.color}`);
    expect(html).toContain("Bills");
    expect(html).not.toContain(">Invoices<");
    expect(html).toContain("Bill paid");
  });

  it("keeps the same focusable heading while the detail loads", () => {
    const html = renderToStaticMarkup(
      createElement(SourcePanel, {
        detail: undefined,
        vendor: "stripe",
        title: "Stripe",
        now: NOW,
        onClose: () => {},
      }),
    );
    expect(html).toMatch(/<h2[^>]*tabindex="-1"[^>]*>Stripe<\/h2>/);
    expect(html).toContain("Loading what Stripe sent...");
    expect(panel("stripe")).toMatch(/<h2[^>]*tabindex="-1"[^>]*>Stripe<\/h2>/);
  });

  it("says when the agent is reading now or a read failed", () => {
    const base = demoSourceDetail("stripe", READ_AT);
    expect(connectionState({ ...base, task: { ...base.task, state: "reading" } }).label).toBe(
      "Reading now",
    );
    expect(connectionState({ ...base, status: "error" }).label).toBe("Read failed");
    expect(connectionState({ ...base, status: "disconnected" }).label).toBe("Not connected");
  });

  it("hover summary has the logo, status, last read and record counts", () => {
    const html = renderToStaticMarkup(
      createElement(SourceHover, {
        detail: demoSourceDetail("stripe", READ_AT),
        vendor: "stripe",
        title: "Stripe",
        now: NOW,
      }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain("Connected");
    expect(html).toContain("3 h ago");
    expect(html).toContain("2,111 rows read, 1,143 records kept");
  });
});

describe("panel focus", () => {
  const el = (name: string, connected = true) => ({
    name,
    isConnected: connected,
    focus: vi.fn(),
  });
  type El = ReturnType<typeof el> & Focusable;

  it("moves focus to the heading on open and back to the opener on close", () => {
    const card = el("stripe card");
    const heading = vi.fn();
    const env = (active: El | null) => ({
      active,
      inPanel: (x: El) => x.name.startsWith("panel"),
      focusHeading: heading,
      opener: () => null,
    });
    let state = panelFocus<El>({ returnTo: null, openId: null }, "source:billing", env(card));
    expect(heading).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ returnTo: card, openId: "source:billing" });
    // Moving to another node from inside the panel keeps the original opener.
    state = panelFocus(state, "agent:ingestion", env(el("panel chip")));
    expect(heading).toHaveBeenCalledTimes(2);
    expect(state.returnTo).toBe(card);
    state = panelFocus(state, null, env(null));
    expect(card.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(state).toEqual({ returnTo: null, openId: null });
  });

  it("falls back to the card with the same open id when the opener re-rendered away", () => {
    const gone = el("old card", false);
    const fresh = el("new card");
    const opener = vi.fn(() => fresh);
    const env = (active: El | null) => ({
      active,
      inPanel: () => false,
      focusHeading: () => {},
      opener,
    });
    const open = panelFocus<El>({ returnTo: null, openId: null }, "source:books", env(gone));
    panelFocus(open, null, env(null));
    expect(opener).toHaveBeenCalledWith("source:books");
    expect(fresh.focus).toHaveBeenCalled();
    expect(gone.focus).not.toHaveBeenCalled();
  });

  it("does nothing on close when no panel was open", () => {
    const opener = vi.fn(() => null);
    const state = panelFocus<El>({ returnTo: null, openId: null }, null, {
      active: null,
      inPanel: () => false,
      focusHeading: () => {},
      opener,
    });
    expect(state).toEqual({ returnTo: null, openId: null });
    expect(opener).not.toHaveBeenCalled();
  });
});
