import Link from "next/link";
import { Activity } from "lucide-react";
import { signOut } from "@/app/login/actions";

export function AppNav({ active, email }: { active: "dashboard" | "settings"; email?: string | null }) {
  return (
    <nav className="nav">
      <Link href="/dashboard" className="brand"><span className="mark"><Activity size={18} /></span> pingdesk</Link>
      <div className="navlinks">
        <Link href="/dashboard" aria-current={active === "dashboard" ? "page" : undefined}>Dashboard</Link>
        <Link href="/settings" aria-current={active === "settings" ? "page" : undefined}>Settings</Link>
        <form action={signOut}><button className="linkbtn" type="submit" title={email ?? undefined}>Sign out</button></form>
      </div>
    </nav>
  );
}

export function Flash({ error, notice }: { error?: string; notice?: string }) {
  if (error) return <p className="flash err" role="alert">{error}</p>;
  if (notice) return <p className="flash ok" role="status">{notice}</p>;
  return null;
}
