import type { FieldFinding } from "./types";

// Turns an audit finding (packages/engine/src/audit.ts wording, or demo fixture text) into
// what a reviewer reads first: who, how much, against what, and when. Display only: the cents
// parsed here are never added up or stored, they only pick a format and an emphasis.

const MONEY = String.raw`-?\$\d[\d,]*(?:\.\d{2})?`;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const MONEY_G = new RegExp(MONEY, "g");
const DATE_G = new RegExp(String.raw`\b${DATE}\b`, "g");

/** Large enough to deserve stronger emphasis on its own: $100,000. */
export const LARGE_CENTS = 10_000_000;

/** "$2606789.74" -> 260678974 cents; "-$5.00" -> -500. Null when it is not a money token. */
export function moneyCents(token: string): number | null {
  const m = /^(-?)\$(\d[\d,]*)(?:\.(\d{2}))?$/.exec(token.trim());
  if (!m) return null;
  const dollars = Number((m[2] ?? "0").replace(/,/g, ""));
  const cents = dollars * 100 + Number(m[3] ?? "0");
  return m[1] ? -cents : cents;
}

const whole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

/** Integer cents -> "$42,000". Amounts under $100 keep their cents ("$4.50"). */
export function formatMoney(cents: number): string {
  const abs = Math.abs(cents);
  const text = abs < 10_000 && abs % 100 !== 0 ? exact.format(abs / 100) : whole.format(abs / 100);
  return cents < 0 ? `-${text}` : text;
}

/** "2026-10-30" -> "Oct 30". */
export function formatDay(iso: string): string {
  if (!new RegExp(`^${DATE}$`).test(iso)) return iso;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const money = (token: string) => {
  const c = moneyCents(token);
  return c === null ? token : formatMoney(c);
};

/** Rewrites raw money and ISO dates in any sentence: "$2606789.74 on 2026-10-30" -> "$2,606,790 on Oct 30". */
export function humanizeText(text: string): string {
  return text.replace(MONEY_G, money).replace(DATE_G, formatDay);
}

export type FindingFact = { label: string; value: string };

export type FindingView = {
  /** Who the money is with, when the finding names them. */
  counterparty: string | null;
  /** One plain sentence, without record ids. */
  headline: string;
  /** Amount, expected amount and date, already formatted. */
  facts: FindingFact[];
  /** The flagged amount in cents (display emphasis only). */
  amountCents: number | null;
};

const capital = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const article = (noun: string) => `${/^[aeiou]/i.test(noun) ? "An" : "A"} ${noun}`;

type Parsed = Omit<FindingView, "amountCents"> & { amount?: string };

function parse(summary: string): Parsed | null {
  let m = new RegExp(
    `^(\\d+) (.+?)s from (.+) for (${MONEY}) on (${DATE}) look like the same entry recorded twice`,
  ).exec(summary);
  if (m) {
    const [, n, label, who, amount, day] = m as unknown as string[];
    return {
      counterparty: capital(who as string),
      headline: `${n} ${label}s for ${money(amount as string)} on ${formatDay(day as string)} look like the same entry recorded twice.`,
      facts: [
        { label: "Amount", value: money(amount as string) },
        { label: "Date", value: formatDay(day as string) },
      ],
      amount,
    };
  }
  m = new RegExp(`^(.+?) (\\S+) from (.+) is (${MONEY}), far above its usual (${MONEY})\\.?$`).exec(
    summary,
  );
  if (m) {
    const [, label, , who, amount, usual] = m as unknown as string[];
    return {
      counterparty: capital(who as string),
      headline: `${article(label as string)} of ${money(amount as string)} is far above the usual ${money(usual as string)}.`,
      facts: [
        { label: "Amount", value: money(amount as string) },
        { label: "Usual", value: money(usual as string) },
      ],
      amount,
    };
  }
  m = /^(.+?) (\S+) changed since the last ingest \((.+)\);/.exec(summary);
  if (m) {
    const [, label, , changes] = m as unknown as string[];
    const amount = new RegExp(`amount (${MONEY}) -> (${MONEY})`).exec(changes as string);
    const party = /party (.+?) -> (.+?)(?:,|$)/.exec(changes as string);
    const day = new RegExp(`date (${DATE}) -> (${DATE})`).exec(changes as string);
    const said = (changes as string)
      .split(", ")
      .map((c) => c.replace(/^(\w+) (.+) -> (.+)$/, "$1 went from $2 to $3"))
      .join(", ");
    return {
      counterparty: party ? capital(party[2] as string) : null,
      headline: `${article(label as string)} changed since the last read: ${humanizeText(said)}. The tool now disagrees with what Domino recorded.`,
      facts: [
        ...(amount
          ? [
              { label: "Now", value: money(amount[2] as string) },
              { label: "Was", value: money(amount[1] as string) },
            ]
          : []),
        ...(day ? [{ label: "Date", value: formatDay(day[2] as string) }] : []),
      ],
      amount: amount?.[2],
    };
  }
  m = new RegExp(`^(.+?) (\\S+) is posted on (${DATE}), after today \\((${DATE})\\)`).exec(summary);
  if (m) {
    const [, label, , day, today] = m as unknown as string[];
    return {
      counterparty: null,
      headline: `${article(label as string)} is dated ${formatDay(day as string)}, after today (${formatDay(today as string)}).`,
      facts: [{ label: "Dated", value: formatDay(day as string) }],
    };
  }
  m = new RegExp(
    `^(.+?) (\\S+) arrived this week but is dated (${DATE}), (\\d+) days before the last ingest`,
  ).exec(summary);
  if (m) {
    const [, label, , day, days] = m as unknown as string[];
    return {
      counterparty: null,
      headline: `${article(label as string)} arrived this week but is dated ${formatDay(day as string)}, ${days} days before the last read.`,
      facts: [{ label: "Dated", value: formatDay(day as string) }],
    };
  }
  m = new RegExp(
    `^No payroll run near (${DATE}): runs are usually (\\d+) days apart but the next one after (${DATE}) is (\\d+) days later`,
  ).exec(summary);
  if (m) {
    const [, near, usual, after, gap] = m as unknown as string[];
    return {
      counterparty: "Payroll",
      headline: `No payroll run near ${formatDay(near as string)}. Runs are usually ${usual} days apart, but the next one after ${formatDay(after as string)} came ${gap} days later.`,
      facts: [{ label: "Expected", value: formatDay(near as string) }],
    };
  }
  if (/^Deal \S+ is won and signed but has no invoice/.test(summary))
    return {
      counterparty: null,
      headline: "A won, signed deal has no invoice yet, so its cash is not scheduled.",
      facts: [],
    };
  return null;
}

/** Removes record ids from a sentence ("bill bill_9 from Acme" -> "bill from Acme"). */
function withoutIds(text: string, refs: string[]): string {
  let out = text;
  for (const ref of refs) out = out.split(` ${ref}`).join("").split(ref).join("");
  return out.replace(/\s{2,}/g, " ").trim();
}

export function describeFinding(finding: Pick<FieldFinding, "summary" | "refs">): FindingView {
  const parsed = parse(finding.summary.trim());
  if (parsed) {
    const { amount, ...view } = parsed;
    return { ...view, amountCents: amount ? moneyCents(amount) : null };
  }
  // Unknown wording (demo text, a newer check): keep the sentence, make its numbers readable.
  const first = finding.summary.match(MONEY_G)?.[0];
  const amountCents = first ? moneyCents(first) : null;
  return {
    counterparty: null,
    headline: capital(humanizeText(withoutIds(finding.summary, finding.refs))),
    facts: amountCents === null ? [] : [{ label: "Amount", value: formatMoney(amountCents) }],
    amountCents,
  };
}

/** Flags that share a record with another flag: id -> the other flag ids. */
export function relatedFlags(findings: Pick<FieldFinding, "id" | "refs">[]): Map<string, string[]> {
  const byRef = new Map<string, string[]>();
  for (const f of findings)
    for (const ref of new Set(f.refs)) byRef.set(ref, [...(byRef.get(ref) ?? []), f.id]);
  const out = new Map<string, string[]>();
  for (const f of findings) {
    const others = new Set(f.refs.flatMap((ref) => byRef.get(ref) ?? []));
    others.delete(f.id);
    if (others.size > 0) out.set(f.id, [...others]);
  }
  return out;
}

/** Optional AI fields another lane adds to findings. Read defensively; shown only when present. */
export function findingExplanation(finding: FieldFinding): {
  explanation?: string;
  suggestedCheck?: string;
} {
  const f = finding as FieldFinding & { explanation?: unknown; suggestedCheck?: unknown };
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { explanation: text(f.explanation), suggestedCheck: text(f.suggestedCheck) };
}
