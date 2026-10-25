import { Dashboard } from "@/components/field/dashboard/Dashboard";

export const metadata = { title: "Dashboard" };

// The shell owns this route; the Field lane owns the dashboard. Sections that wait on the
// Timeline lane are labelled as sample data inside it.
export default function DashboardSlot() {
  return <Dashboard />;
}
