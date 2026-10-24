import { CompanyScreen } from "@/components/company/CompanyScreen";

export const metadata = { title: "Cash forecast" };

export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <CompanyScreen key={companyId} companyId={companyId} />;
}
