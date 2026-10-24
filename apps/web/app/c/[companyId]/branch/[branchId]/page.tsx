import { BranchScreen } from "@/components/flows/BranchDetail";

export const metadata = { title: "Scenario detail" };
export default async function Page({
  params,
}: { params: Promise<{ companyId: string; branchId: string }> }) {
  const { companyId, branchId } = await params;
  return (
    <BranchScreen key={`${companyId}:${branchId}`} companyId={companyId} branchId={branchId} />
  );
}
