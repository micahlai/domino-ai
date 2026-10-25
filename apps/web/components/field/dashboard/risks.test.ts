import { describe, expect, it } from "vitest";
import { counterpartySignals } from "./risks";

describe("counterparty signals for the risk view", () => {
  it("keeps Apify entries with their run id and drops other research and unsafe links", () => {
    const out = counterpartySignals([
      { provider: "creao", input: "x", remoteRunId: "c1", items: ["note"] },
      {
        provider: "apify",
        input: "Northwind Health",
        role: "customer",
        remoteRunId: "S9NcXY5xnQVkdUfXU",
        fetchedAt: "2026-10-25T07:33:55.000Z",
        signals: [
          {
            title: "Northwind Health names new CEO",
            url: "https://news.example.com/a",
            source: "news.example.com",
            kinds: ["leadership"],
          },
          { title: "Bad link", url: "javascript:alert(1)", source: "x", kinds: [] },
        ],
      },
      { provider: "apify", input: "Acme Logistics", remoteRunId: "lF0Fyo28NXCEK8kd9", signals: [] },
    ]);
    expect(out).toEqual([
      {
        counterparty: "Northwind Health",
        role: "customer",
        runId: "S9NcXY5xnQVkdUfXU",
        fetchedAt: "2026-10-25T07:33:55.000Z",
        headlines: [
          {
            title: "Northwind Health names new CEO",
            url: "https://news.example.com/a",
            source: "news.example.com",
            date: null,
            kinds: ["leadership"],
          },
        ],
      },
      {
        counterparty: "Acme Logistics",
        role: null,
        runId: "lF0Fyo28NXCEK8kd9",
        fetchedAt: "",
        headlines: [],
      },
    ]);
    expect(counterpartySignals(undefined)).toEqual([]);
  });
});
