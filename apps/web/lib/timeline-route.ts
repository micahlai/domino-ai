/** Next can pass an encoded catchall-like company segment to a dynamic route. */
export function decodeTimelineCompanyId(companyId: string): string {
  if (!companyId.includes("%")) return companyId;
  try {
    return decodeURIComponent(companyId);
  } catch {
    return companyId;
  }
}
