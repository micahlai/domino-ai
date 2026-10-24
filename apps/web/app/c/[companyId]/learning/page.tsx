import { LearningScreen } from "@/components/learning/LearningScreen";
export const metadata = { title: "What we learned" };
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <LearningScreen key={companyId} companyId={companyId} />;
}
