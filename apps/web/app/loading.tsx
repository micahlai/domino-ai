import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6 p-6">
      <output className="block text-sm text-muted-foreground">Loading your workspace...</output>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
