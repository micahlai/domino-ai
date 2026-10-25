// Deterministic readers for the words a person types: money, dates and day counts.
// Reading "$80k" as 8_000_000 cents is unit conversion of the person's own number, done
// exactly in BigInt; nothing here adds, nets or forecasts money.

const MONEY =
  /^\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(billion|million|thousand|bn|mm|k|m|b))?$/i;
const MONEY_WORD =
  /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(billion|million|thousand|bn|mm|k|m|b)?\s*(?:dollars|usd)$/i;
// "50m" or "2 million" with no currency sign. A bare number needs a scale to read as money.
const MONEY_SCALED =
  /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(billion|million|thousand)|(bn|mm|k|m|b))$/i;
// Read the entire numeric token, including malformed grouping/signs, before validation.
const MONEY_TOKEN =
  /(?:[-+]\s*)?\$\s*[-+]?\s*\d[\d.,]*(?:\s+\d[\d.,]*)*(?:\s*(?:billion|million|thousand|bn|mm|k|m|b)\b)?|[-+]?\d[\d.,]*(?:\s+\d[\d.,]*)*(?:\s*(?:billion|million|thousand|bn|mm|k|m|b)\b)?\s+(?:dollars|usd)\b|(?<![\w$.,])[-+]?\d[\d.,]*(?:\s*(?:billion|million|thousand)|(?:bn|mm|k|m|b))\b/gi;
export const moneyTokens = (text: string): string[] =>
  [...text.matchAll(MONEY_TOKEN)].map((m) =>
    // A single sentence delimiter is not part of the number. Internal/broken grouping stays intact.
    m[0].replace(/[.,]$/, ""),
  );
const SCALE: Record<string, bigint> = {
  "": 1n,
  k: 1_000n,
  thousand: 1_000n,
  m: 1_000_000n,
  mm: 1_000_000n,
  million: 1_000_000n,
  b: 1_000_000_000n,
  bn: 1_000_000_000n,
  billion: 1_000_000_000n,
};

/** First money phrase in the text, exactly as written, or null. */
export function findMoneyText(text: string): string | null {
  return moneyTokens(text)[0] ?? null;
}

/**
 * Integer cents for one money phrase, or null when it is not exact to the cent or is not a
 * safe integer. "$1.2M" -> 120_000_000; "$10.005" -> null.
 */
export function parseMoneyText(text: string): number | null {
  const m =
    MONEY.exec(text.trim()) ?? MONEY_WORD.exec(text.trim()) ?? MONEY_SCALED.exec(text.trim());
  if (!m || m.index !== 0 || m[0].length !== text.trim().length) return null;
  const whole = (m[1] ?? "").replaceAll(",", "");
  const frac = m[2] ?? "";
  if (frac.length > 12) return null;
  const scale = SCALE[(m[3] ?? m[4] ?? "").toLowerCase()] ?? 1n;
  const numerator = BigInt(whole + frac) * scale * 100n;
  const denominator = 10n ** BigInt(frac.length);
  if (numerator % denominator !== 0n) return null;
  const cents = numerator / denominator;
  return cents > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(cents);
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const MONTH_DAY = new RegExp(
  `\\b${MONTH_RE}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
  "i",
);
const DAY_MONTH = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`,
  "i",
);
export const MONTH_WORD = new RegExp(`^${MONTH_RE}\\.?$`, "i");

/** First date phrase in the text, exactly as written, or null. */
export function findDateText(text: string): string | null {
  return (ISO.exec(text) ?? MONTH_DAY.exec(text) ?? DAY_MONTH.exec(text))?.[0] ?? null;
}

/** Whole source phrases for provider provenance, including explicit or malformed years/signs.
 * Unlike finding a date, this must not let "Nov 17" be copied out of "Nov 17, 2027". */
export function dateTokens(text: string): string[] {
  const phrases = new RegExp(
    `(?:[-+]\\s*)?(?:${ISO.source}|${MONTH_DAY.source}|${DAY_MONTH.source})`,
    "gi",
  );
  return [...text.matchAll(phrases)].map((match) => {
    // Preserve an explicit suffix even if its spacing/year shape is not supported by the
    // date parser. It must clarify rather than silently default to the forecast's year.
    const tail = text.slice((match.index ?? 0) + match[0].length);
    const extraYear = /^(?:,\s*|\s+)\d+\b/.exec(tail)?.[0] ?? "";
    return match[0] + extraYear;
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
function calendar(y: number, m: number, d: number): string | null {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d)
    return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const monthIndex = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase() as never) + 1;

/**
 * ISO date for one date phrase. A phrase without a year takes the first matching date on or
 * after `anchor` (the forecast start), so "Nov 18" means the coming Nov 18. Null if invalid.
 */
export function parseDateText(text: string, anchor: string): string | null {
  const t = text.trim();
  const iso = ISO.exec(t);
  if (iso && iso[0] === t) return calendar(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  let month: number;
  let day: number;
  let year: number | null;
  const md = MONTH_DAY.exec(t);
  const dm = DAY_MONTH.exec(t);
  if (md && md[0] === t) {
    month = monthIndex(md[1] ?? "");
    day = Number(md[2]);
    year = md[3] ? Number(md[3]) : null;
  } else if (dm && dm[0] === t) {
    day = Number(dm[1]);
    month = monthIndex(dm[2] ?? "");
    year = dm[3] ? Number(dm[3]) : null;
  } else return null;
  if (year !== null) return calendar(year, month, day);
  const anchorYear = Number(anchor.slice(0, 4));
  const sameYear = calendar(anchorYear, month, day);
  if (sameYear && sameYear >= anchor) return sameYear;
  return calendar(anchorYear + 1, month, day);
}

const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const COUNT_TOKEN =
  /(?<![\w.])[-+]?\d+(?:[.,]\d+)*\s+(?:days?|weeks?|months?)\b|\b(?:an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?)\b/gi;
export const countTokens = (text: string): string[] =>
  [...text.matchAll(COUNT_TOKEN)].map((m) => m[0]);
export const findDaysText = (text: string) =>
  countTokens(text).find((s) => /(?:days?|weeks?)$/i.test(s)) ?? null;
export const findMonthsText = (text: string) =>
  countTokens(text).find((s) => /months?$/i.test(s)) ?? null;
const count = (word: string) =>
  /^\d+(?:\.\d+)?$/.test(word) ? Number(word) : COUNT_WORDS[word.toLowerCase()];

/** Whole days only: a fractional count is not rounded or matched by its suffix. */
export function parseDaysText(text: string): number | null {
  const m = /^(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?)$/i.exec(
    text.trim(),
  );
  if (!m) return null;
  const n = count(m[1] ?? "");
  if (n === undefined || !Number.isSafeInteger(n)) return null;
  return (m[2] ?? "").toLowerCase().startsWith("week") ? n * 7 : n;
}

/** Fractional months are supported by the shared rule evaluator. */
export function parseMonthsText(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+months?$/i.exec(
    text.trim(),
  );
  if (!m) return null;
  const n = count(m[1] ?? "");
  return n !== undefined && Number.isFinite(n) ? n : null;
}

/** "$1,234.50" from integer cents, display only. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = BigInt(Math.abs(cents));
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = abs % 100n;
  return `${sign}$${dollars}${rest === 0n ? "" : `.${rest.toString().padStart(2, "0")}`}`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "Nov 18, 2026" from an ISO date, display only. */
export function formatDate(iso: string): string {
  return `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}

/** Monday of the week containing an ISO date (weeks start on Monday). */
export function mondayOf(iso: string): string {
  const t = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const t = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}
