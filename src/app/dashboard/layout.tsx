import { requireUser } from "@/lib/supabase/server";
import { DashboardNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="app">
      <DashboardNav email={user.email ?? ""} />
      <main className="app-main">{children}</main>
    </div>
  );
}
