import { Dashboard } from "@/components/field/dashboard/Dashboard";

export const metadata = { title: "Dashboard" };

// The shell owns this route; the Field lane owns the dashboard. Parts not backed by real
// analysis are labelled Illustrative inside it.
export default function DashboardSlot() {
  return <Dashboard />;
}
