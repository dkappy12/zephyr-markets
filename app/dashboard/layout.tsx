import { DashboardChrome } from "@/components/dashboard/DashboardChrome";
import { ThemeProvider } from "@/context/ThemeContext";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </ThemeProvider>
  );
}
