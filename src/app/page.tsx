import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, Bell, Mail, MessageCircle, ShieldCheck, ArrowUpRight } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";

export default async function Home() {
 if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (user) redirect("/dashboard");
 }
 return <main className="shell">
  <nav className="nav"><div className="brand"><span className="mark"><Activity size={18}/></span> pingdesk</div><Link className="outline sm" href="/login">Sign in</Link></nav>
  <section className="hero"><p className="eyebrow">BUSINESS NOTIFICATION INFRASTRUCTURE</p><h1>Stay close to<br/><span>what matters.</span></h1><p className="sub">Important email notifications, delivered to the WhatsApp you already check.</p><Link className="primary" href="/login?mode=signup">Set up PingDesk <ArrowUpRight size={16}/></Link></section>
    <section id="setup" className="section"><p className="eyebrow">CONNECTIONS</p><h2>Bring your tools together.</h2>
   <div className="connection"><span className="tile"><Mail/></span><div><b>Email inbox</b><p>Authorize Gmail securely using Google OAuth.</p></div><Link className="outline" href="/login?mode=signup">Connect Gmail</Link></div>
   <div className="connection"><span className="tile green"><MessageCircle/></span><div><b>WhatsApp delivery</b><p>Alerts arrive through the official WhatsApp Business API.</p></div><Link className="outline" href="/login?mode=signup">Add number</Link></div>
  </section>
  <section className="section"><p className="eyebrow">BUILT AROUND TRUST</p><h2>Useful alerts. No platform shortcuts.</h2><div className="features"><article><ShieldCheck/><b>Authorized access</b><p>OAuth-based email access. No inbox passwords.</p></article><article><Bell/><b>Notification only</b><p>Alerts point you back to the original platform.</p></article><article><Activity/><b>Delivery visibility</b><p>Track what was processed and what was delivered.</p></article></div></section>
  <footer>PingDesk <span>Notification infrastructure for work.</span></footer>
 </main>;
}
