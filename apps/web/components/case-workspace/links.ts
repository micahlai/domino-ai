// One place for the case's addresses. `c` selects the investigation on the workspace, company and
// list pages; the detail page carries it in its path. Navigation keeps whichever is open.

export const CASE_BASE = "/case/2u";

const withInvestigation = (path: string, id: string | undefined) =>
  id ? `${path}?c=${encodeURIComponent(id)}` : path;

export const caseHref = {
  workspace: (id?: string) => withInvestigation(CASE_BASE, id),
  company: (id?: string) => withInvestigation(`${CASE_BASE}/company`, id),
  simulations: (id?: string) => withInvestigation(`${CASE_BASE}/simulations`, id),
  /** Backtest from the Nov 10, 2023 cutoff; it keeps its own saved forecast, not an investigation. */
  backtest: () => `${CASE_BASE}/backtest`,
  detail: (id: string) => `${CASE_BASE}/simulations/${encodeURIComponent(id)}`,
};

/** The open investigation: the detail page's path wins over `c`, so links never disagree. */
export function openInvestigation(pathname: string, c: string | null | undefined) {
  const prefix = `${CASE_BASE}/simulations/`;
  if (pathname.startsWith(prefix)) {
    const id = pathname.slice(prefix.length).split("/")[0];
    try {
      return id ? decodeURIComponent(id) : c || undefined;
    } catch {
      return c || undefined;
    }
  }
  return c || undefined;
}
