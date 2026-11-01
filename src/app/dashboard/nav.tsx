"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Activity, History, Inbox, LayoutGrid, Menu, MessageCircle, Settings, SlidersHorizontal, X } from "lucide-react";

const LINKS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/inboxes", label: "Inboxes", icon: Inbox },
  { href: "/dashboard/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/dashboard/history", label: "History", icon: History },
  { href: "/dashboard/preferences", label: "Preferences", icon: SlidersHorizontal },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function DashboardNav({ email }: { email: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="topbar">
        <Link href="/dashboard" className="brand">
          <span className="mark">
            <Activity size={16} aria-hidden />
          </span>
          pingdesk
        </Link>
        <button
          type="button"
          className="icon-btn"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      <aside id="sidebar" className={`sidebar ${open ? "open" : ""}`}>
        <Link href="/dashboard" className="brand sidebar-brand">
          <span className="mark">
            <Activity size={16} aria-hidden />
          </span>
          pingdesk
        </Link>
        <nav aria-label="Dashboard">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = href === "/dashboard" ? path === href : path.startsWith(href);
            return (
              <Link key={href} href={href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
                <Icon size={17} aria-hidden /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="sidebar-email" title={email}>
            {email}
          </span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-link small">
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
