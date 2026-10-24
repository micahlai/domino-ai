import { ConnectScreen } from "@/components/flows/ConnectScreen";

export const metadata = { title: "Connect a company" };
export default async function Page({
  searchParams,
}: { searchParams: Promise<{ companyId?: string }> }) {
  const { companyId } = await searchParams;
  return <ConnectScreen key={companyId ?? "new"} initialId={companyId} />;
}
