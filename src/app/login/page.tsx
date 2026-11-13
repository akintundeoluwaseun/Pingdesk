import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/user";
import { signIn, signUp } from "./actions";

export const metadata = { title: "Sign in · PingDesk" };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (user) redirect(next);
  const signup = sp.mode === "signup";
  const other = `/login?mode=${signup ? "signin" : "signup"}&next=${encodeURIComponent(next)}`;

  return (
    <main className="shell narrow">
      <nav className="nav"><Link href="/" className="brand"><span className="mark"><Activity size={18} /></span> pingdesk</Link></nav>
      <section className="card auth">
        <h1 className="h-sm">{signup ? "Create your account" : "Sign in"}</h1>
        <p className="sub">{signup ? "Then connect Gmail and add the WhatsApp number for alerts." : "Welcome back."}</p>
        {sp.error && <p className="flash err" role="alert">{sp.error}</p>}
        {sp.notice && <p className="flash ok" role="status">{sp.notice}</p>}
        <form action={signup ? signUp : signIn} className="form">
          <input type="hidden" name="next" value={next} />
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 8 : undefined} required /></label>
          <button className="primary block" type="submit">{signup ? "Create account" : "Sign in"}</button>
        </form>
        <p className="muted center">{signup ? "Already have an account?" : "New to PingDesk?"} <Link href={other}>{signup ? "Sign in" : "Create an account"}</Link></p>
      </section>
    </main>
  );
}
