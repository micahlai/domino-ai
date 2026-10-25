import type { RunKey } from "../workspace/api";
import { type RequestLedger, describeWriteError } from "../workspace/requests";
import { type RetryArgs, type StartArgs, StartResultSchema } from "./api";

export type AnalysisWriteResult = { ok: true; analysisId: string } | { ok: false; message: string };
/** One reviewed operation. Uncertain writes retain their id; confirmed writes allow a new attempt. */
export async function requestAnalysis(
  key: RunKey,
  retryAnalysisId: string | null,
  ledger: RequestLedger,
  call: {
    start: (args: StartArgs) => Promise<unknown>;
    retry: (args: RetryArgs) => Promise<unknown>;
  },
): Promise<AnalysisWriteResult> {
  const payload = JSON.stringify([retryAnalysisId ? "retry" : "start", key, retryAnalysisId]);
  const requestId = ledger.idFor(payload);
  try {
    const raw = retryAnalysisId
      ? await call.retry({
          companyId: key.companyId,
          analysisId: retryAnalysisId,
          requestId,
          reviewed: true,
        })
      : await call.start({ ...key, requestId, reviewed: true });
    const p = StartResultSchema.safeParse(raw);
    if (!p.success || p.data.companyId !== key.companyId)
      return {
        ok: false,
        message:
          "The service answered, but the saved analysis link could not be verified. Check the saved attempt list before starting another.",
      };
    ledger.renew(payload);
    return { ok: true, analysisId: p.data.analysisId };
  } catch (e) {
    return { ok: false, message: describeWriteError(e) };
  }
}
