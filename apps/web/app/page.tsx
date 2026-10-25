import { Dashboard } from "@/components/timeline/dashboard/Dashboard";

export const metadata = { title: "Dashboard" };

// The shell owns this route; the Timeline lane owns what the dashboard shows.
export default function DashboardSlot() {
  return <Dashboard />;
}
