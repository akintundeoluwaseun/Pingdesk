import { Activity, Bell, Mail, MessageCircle, ShieldCheck, ArrowUpRight } from "lucide-react";
export default function Home() {
 return <main className="shell">
  <nav className="nav"><div className="brand"><span className="mark"><Activity size={18}/></span> pingdesk</div><span className="status"><i/> Cloud notification centre</span></nav>
  <section className="hero"><p className="eyebrow">BUSINESS NOTIFICATION INFRASTRUCTURE</p><h1>Stay close to<br/><span>what matters.</span></h1><p className="sub">Important email notifications, delivered to the WhatsApp you already check.</p><a className="primary" href="#setup">Set up PingDesk <ArrowUpRight size={16}/></a></section>
  <section className="metrics"><div><small>Alerts today</small><strong>—</strong><small>Connect an inbox to begin</small></div><div><small>Delivery status</small><strong>—</strong><small>No live events yet</small></div></section>
  <section id="setup" className="section"><p className="eyebrow">CONNECTIONS</p><h2>Bring your tools together.</h2>
   <div className="connection"><span className="tile"><Mail/></span><div><b>Email inbox</b><p>Authorize Gmail securely using Google OAuth.</p></div><a className="outline" href="/api/google/connect">Connect Gmail</a></div>
   <div className="connection"><span className="tile green"><MessageCircle/></span><div><b>WhatsApp delivery</b><p>Configure the official WhatsApp Business API.</p></div><span className="muted">Requires Meta setup</span></div>
  </section>
  <section className="section"><p className="eyebrow">BUILT AROUND TRUST</p><h2>Useful alerts. No platform shortcuts.</h2><div className="features"><article><ShieldCheck/><b>Authorized access</b><p>OAuth-based email access. No inbox passwords.</p></article><article><Bell/><b>Notification only</b><p>Alerts point you back to the original platform.</p></article><article><Activity/><b>Delivery visibility</b><p>Track what was processed and what was delivered.</p></article></div></section>
  <footer>PingDesk <span>Notification infrastructure for work.</span></footer>
 </main>;
}
