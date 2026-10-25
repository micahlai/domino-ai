import { describe, expect, it } from "vitest";
import {
  CRS_PERSONAS,
  CrsLoginError,
  parseFraud,
  parseIdentity,
  personaFor,
  runCrsCheck,
} from "../connectors/crs";

describe("CRS connector", () => {
  it("maps a vendor key to the same sandbox persona every time", () => {
    expect(personaFor("Acme|1234").id).toBe(personaFor("acme|1234 ").id);
    expect(CRS_PERSONAS.map((p) => p.id)).toContain(personaFor("x").id);
  });

  it("reads TruValidate messages and Fraud Finder fields", () => {
    const pass = parseIdentity(
      { addOnProducts: [{ idManagerVerification: { messages: [] } }] },
      null,
    );
    expect(pass.result).toBe("PASS");
    const fail = parseIdentity(
      {
        addOnProducts: [
          { idManagerVerification: { messages: [{ code: "2301", text: "deceased" }] } },
        ],
      },
      "r1",
    );
    expect(fail).toEqual({
      result: "FAIL",
      messages: [{ code: "2301", text: "deceased" }],
      requestId: "r1",
    });
    const fraud = parseFraud({ risk: { score: 88 }, email_validation: { status: "risky" } }, null);
    expect(fraud.score).toBe(88);
    expect(fraud.emailStatus).toBe("risky");
  });

  it("logs in once, runs both products, and refuses on a failed login", async () => {
    const p = CRS_PERSONAS[0];
    if (!p) throw new Error("no persona");
    const paths: string[] = [];
    const ok = await runCrsCheck(p, { username: "u", password: "p" }, async (path) => {
      paths.push(path);
      if (path === "/users/login") return { status: 200, body: { token: "t" }, requestId: null };
      if (path.startsWith("/transunion"))
        return { status: 200, body: { idManagerVerification: { messages: [] } }, requestId: "a" };
      return { status: 200, body: { risk: { score: 11 } }, requestId: "b" };
    });
    expect(paths).toHaveLength(3);
    expect(ok.verdict).toBe("verified");
    await expect(
      runCrsCheck(p, { username: "u", password: "p" }, async () => ({
        status: 401,
        body: { codes: ["CRS111"] },
        requestId: null,
      })),
    ).rejects.toBeInstanceOf(CrsLoginError);
  });
});
