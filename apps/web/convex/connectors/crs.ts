/**
 * CRS (crscreditapi.com) sandbox connector: identity and fraud checks on the person behind a
 * vendor's bank account. Two products, both real sandbox calls:
 *   POST /users/login                                         -> Bearer token
 *   POST /transunion/identity-manager-verification/basic      -> TransUnion TruValidate identity
 *   POST /fraud-finder/fraud-finder                           -> CRS Fraud Finder (AtData)
 *
 * Domino's simulated vendors have no real owners, so each check stands in one of the CRS sandbox
 * test personas (fake people with canned results) for the vendor's account owner, picked
 * deterministically from the vendor and the new account. Persona bodies are sent exactly as CRS
 * publishes them (@crscreditapi/crs-calhacks-mcp-server test data), so they match the sandbox's
 * canned cases and are free. Never send real people's details here.
 *
 * Credentials come from CRS_USERNAME / CRS_PASSWORD only and never appear in logs or errors.
 * Repeated failed logins lock the sandbox account, so the caller stops after one failure.
 */

export const CRS_BASE = "https://api-sandbox.stitchcredit.com/api";

type Address = { addressLine1: string; city: string; state: string; postalCode: string };
export type CrsPersona = {
  id: string;
  name: string;
  profile: string;
  identity: {
    firstName: string;
    lastName: string;
    ssn: string;
    dob: string;
    street1: string;
    city: string;
    state: string;
    zip: string;
  };
  fraud: {
    firstName: string;
    lastName: string;
    phoneNumber: string;
    email: string;
    ipAddress: string;
    address: Address;
  };
};

const persona = (
  id: string,
  first: string,
  last: string,
  profile: string,
  ssn: string,
  dob: string,
  phone: string,
  email: string,
  ip: string,
  street1: string,
  city: string,
  state: string,
  zip: string,
): CrsPersona => ({
  id,
  name: `${first} ${last}`,
  profile,
  identity: { firstName: first, lastName: last, ssn, dob, street1, city, state, zip },
  fraud: {
    firstName: first,
    lastName: last,
    phoneNumber: phone,
    email,
    ipAddress: ip,
    address: { addressLine1: street1, city, state, postalCode: zip },
  },
});

/** The sandbox personas a vendor's account owner can map to: clean and risky ones. */
export const CRS_PERSONAS: readonly CrsPersona[] = [
  persona(
    "P01",
    "MARGARET",
    "OKAFOR",
    "Prime",
    "666701001",
    "1984-03-14",
    "5550101001",
    "margaret.okafor@example.com",
    "203.0.113.11",
    "1420 WILLOW CREEK DR",
    "SAN JOSE",
    "CA",
    "95125",
  ),
  persona(
    "P12",
    "VICTOR",
    "ANAND",
    "Identity mismatch",
    "666701012",
    "1968-08-08",
    "5550101012",
    "v.anand.1968@example.com",
    "198.51.100.12",
    "55 WATER ST FL 20",
    "NEW YORK",
    "NY",
    "10041",
  ),
  persona(
    "P19",
    "GRACE",
    "NAKAMURA",
    "Small-business owner",
    "666701019",
    "1976-09-16",
    "5550101019",
    "grace.nakamura@example.com",
    "203.0.113.29",
    "1850 SOLANO AVE",
    "BERKELEY",
    "CA",
    "94707",
  ),
  persona(
    "P13",
    "KAYLA",
    "BRENNAN",
    "Synthetic identity",
    "666701013",
    "1999-12-24",
    "5550101013",
    "kb.9921x@example.com",
    "198.51.100.13",
    "9021 KINGSTON PIKE",
    "KNOXVILLE",
    "TN",
    "37923",
  ),
  persona(
    "P16",
    "SAMUEL",
    "OYELARAN",
    "Fraud alert on file",
    "666701016",
    "1977-06-12",
    "5550101016",
    "samuel.oyelaran@example.com",
    "203.0.113.26",
    "1200 BRICKELL BAY DR APT 2203",
    "MIAMI",
    "FL",
    "33131",
  ),
  persona(
    "P02",
    "DANIEL",
    "WHITFIELD",
    "Super-prime",
    "666701002",
    "1972-11-02",
    "5550101002",
    "daniel.whitfield@example.com",
    "203.0.113.12",
    "88 LAKESHORE BLVD",
    "AUSTIN",
    "TX",
    "78746",
  ),
  persona(
    "P14",
    "HAROLD",
    "PETTIGREW",
    "Deceased indicator",
    "666701014",
    "1948-01-19",
    "5550101014",
    "harold.pettigrew@example.com",
    "203.0.113.24",
    "310 ELM ST",
    "DAYTON",
    "OH",
    "45402",
  ),
];

/** FNV-1a: the same key always picks the same persona. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function personaFor(key: string): CrsPersona {
  return CRS_PERSONAS[hash(key.trim().toLowerCase()) % CRS_PERSONAS.length] as CrsPersona;
}

export type CrsIdentity = {
  result: "PASS" | "FAIL" | "REVIEW";
  messages: { code: string; text: string }[];
  requestId: string | null;
};
export type CrsFraud = {
  score: number | null;
  emailStatus: string | null;
  emailFirstSeen: string | null;
  domainRisk: number | null;
  phoneMatch: string | null;
  addressMatch: string | null;
  requestId: string | null;
};
export type CrsVerdict = "verified" | "signals" | "unavailable" | "not_configured" | "capped";
export type CrsCheckResult = {
  verdict: CrsVerdict;
  personaId: string;
  personaName: string;
  personaProfile: string;
  identity: CrsIdentity | null;
  fraud: CrsFraud | null;
  /** Plain words for the flag. */
  headline: string;
  signals: string[];
  /** HTTP calls made to CRS for this check (0 when cached). */
  calls: number;
  detail: string | null;
};

const rec = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const num = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x)
    ? x
    : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))
      ? Number(x)
      : null;
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

/** Finds the first `idManagerVerification` object anywhere in a TruValidate SubjectRecord. */
function findKey(x: unknown, key: string, depth = 0): unknown {
  if (depth > 8 || !x || typeof x !== "object") return undefined;
  if (Array.isArray(x)) {
    for (const item of x) {
      const found = findKey(item, key, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const o = x as Record<string, unknown>;
  if (key in o) return o[key];
  for (const value of Object.values(o)) {
    const found = findKey(value, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** TruValidate messages: none = PASS; 2401 (fraud alert) = REVIEW (step up); others = FAIL. */
export function parseIdentity(body: unknown, requestId: string | null): CrsIdentity {
  const imv = rec(findKey(body, "idManagerVerification"));
  const raw = Array.isArray(imv.messages) ? imv.messages : [];
  const messages = raw
    .map((m) => rec(m))
    .map((m) => ({ code: String(m.code ?? "").trim(), text: String(m.text ?? "").trim() }))
    .filter((m) => m.code || m.text);
  const result =
    messages.length === 0 ? "PASS" : messages.every((m) => m.code === "2401") ? "REVIEW" : "FAIL";
  return { result, messages, requestId };
}

export function parseFraud(body: unknown, requestId: string | null): CrsFraud {
  const o = rec(body);
  const risk = rec(o.risk);
  const postal = rec(risk.postal);
  const phone = rec(risk.phone);
  const owner = rec(phone.owner);
  return {
    score: num(risk.score),
    emailStatus: str(rec(o.email_validation).status),
    emailFirstSeen: str(rec(o.eam).date_first_seen),
    domainRisk: num(rec(risk.domain).domain_risk_score),
    phoneMatch: str(owner.match) ?? str(owner.name_match) ?? str(phone.owner_match),
    addressMatch: str(postal.address_match) ?? str(postal.postal_match),
    requestId,
  };
}

/** Verified / signals from both products, with the CRS fields that drove it. */
export function verdictOf(
  p: CrsPersona,
  identity: CrsIdentity | null,
  fraud: CrsFraud | null,
  calls: number,
  detail: string | null,
): CrsCheckResult {
  const signals: string[] = [];
  if (identity && identity.result !== "PASS")
    for (const m of identity.messages)
      signals.push(`TruValidate ${m.code || "?"}: ${m.text || "identity problem"}`);
  if (fraud?.score != null && fraud.score >= 70)
    signals.push(`Fraud Finder risk ${fraud.score}/100 (high)`);
  else if (fraud?.score != null && fraud.score >= 40)
    signals.push(`Fraud Finder risk ${fraud.score}/100 (medium)`);
  if (fraud?.emailStatus && fraud.emailStatus !== "valid")
    signals.push(`Email ${fraud.emailStatus}`);
  if (fraud?.phoneMatch === "no_match") signals.push("Phone owner does not match");
  const base = {
    personaId: p.id,
    personaName: p.name,
    personaProfile: p.profile,
    identity,
    fraud,
    calls,
  };
  if (!identity && !fraud)
    return {
      ...base,
      verdict: "unavailable",
      headline: "CRS unreachable: identity not checked",
      signals: [],
      detail,
    };
  const verdict: CrsVerdict = signals.length > 0 ? "signals" : "verified";
  const score = fraud?.score != null ? `, fraud risk ${fraud.score}/100` : "";
  return {
    ...base,
    verdict,
    headline:
      verdict === "verified"
        ? `Identity verified (TruValidate ${identity?.result ?? "n/a"}${score})`
        : `Fraud signals: ${signals.join("; ")}`,
    signals,
    detail,
  };
}

export type CrsHttp = (
  path: string,
  init: { body: unknown; token?: string },
) => Promise<{ status: number; body: unknown; requestId: string | null }>;

export const crsHttp: CrsHttp = async (path, { body, token }) => {
  const res = await fetch(`${CRS_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed, requestId: res.headers.get("RequestID") };
};

export class CrsLoginError extends Error {}

/** Short, credential-free description of a CRS error body. */
function errorOf(status: number, body: unknown): string {
  const o = rec(body);
  const codes = Array.isArray(o.codes) ? o.codes.join(",") : "";
  const msg = Array.isArray(o.messages) ? o.messages.join("; ") : (str(o.message) ?? "");
  return `HTTP ${status}${codes ? ` ${codes}` : ""}${msg ? `: ${msg.slice(0, 160)}` : ""}`;
}

/** Login once, then both products. A failed login throws CrsLoginError (caller must not retry). */
export async function runCrsCheck(
  p: CrsPersona,
  creds: { username: string; password: string },
  http: CrsHttp = crsHttp,
): Promise<CrsCheckResult> {
  const login = await http("/users/login", { body: creds });
  const token = str(rec(login.body).token);
  if (login.status !== 200 || !token)
    throw new CrsLoginError(`CRS login failed (${errorOf(login.status, login.body)})`);
  let calls = 1;
  const problems: string[] = [];
  let identity: CrsIdentity | null = null;
  let fraud: CrsFraud | null = null;
  const [idRes, frRes] = await Promise.allSettled([
    http("/transunion/identity-manager-verification/basic", { body: p.identity, token }),
    http("/fraud-finder/fraud-finder", { body: p.fraud, token }),
  ]);
  calls += 2;
  if (idRes.status === "fulfilled" && idRes.value.status === 200)
    identity = parseIdentity(idRes.value.body, idRes.value.requestId);
  else
    problems.push(
      `TruValidate ${idRes.status === "fulfilled" ? errorOf(idRes.value.status, idRes.value.body) : "unreachable"}`,
    );
  if (frRes.status === "fulfilled" && frRes.value.status === 200)
    fraud = parseFraud(frRes.value.body, frRes.value.requestId);
  else
    problems.push(
      `Fraud Finder ${frRes.status === "fulfilled" ? errorOf(frRes.value.status, frRes.value.body) : "unreachable"}`,
    );
  return verdictOf(p, identity, fraud, calls, problems.length > 0 ? problems.join("; ") : null);
}
