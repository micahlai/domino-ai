import { RecordScreen } from "@/components/records/RecordScreen";
export const metadata = { title: "Decision record" };
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <RecordScreen key={companyId} companyId={companyId} />;
}
