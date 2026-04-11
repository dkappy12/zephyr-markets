import { DashboardChrome } from "@/components/dashboard/DashboardChrome";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardChrome>{children}</DashboardChrome>;
}
