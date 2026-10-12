"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  FileText,
  Hash,
  Lock,
  LayoutDashboard,
  Megaphone,
  Radio,
  Settings,
  UserSearch,
  type LucideIcon,
} from "lucide-react";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/guests", label: "Guest Radar", icon: UserSearch },
  { href: "/topics", label: "Topic Radar", icon: Hash },
  { href: "/sponsors", label: "Sponsor Radar", icon: Megaphone },
  { href: "/brief", label: "Weekly Brief", icon: FileText },
];

const MANAGE: typeof NAV = [
  { href: "/research", label: "Research Center", icon: Compass },
  { href: "/settings", label: "Data Sources", icon: Settings },
  { href: "/admin", label: "Admin", icon: Lock },
];

function NavLink({ href, label, icon: Icon }: (typeof NAV)[number]) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] transition-colors ${
        active
          ? "bg-accent/25 text-ink ring-1 ring-accent/40"
          : "text-muted hover:bg-panel hover:text-ink"
      }`}
    >
      <Icon size={18} className={active ? "text-soft" : ""} />
      {label}
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="flex shrink-0 flex-col gap-4 bg-shell/90 p-4 ring-1 ring-line backdrop-blur lg:sticky lg:top-5 lg:h-[calc(100vh-2.5rem)] lg:w-64 lg:rounded-3xl lg:p-5">
      <Link href="/" className="flex items-center gap-2.5 px-1.5 py-1">
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent2">
          <Radio size={18} />
        </span>
        <span className="text-lg font-semibold tracking-tight">
          Podcast <span className="font-light">Radar</span>
        </span>
      </Link>

      <nav className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Main">
        <p className="hidden px-3.5 pt-3 pb-1 text-xs tracking-wider text-muted uppercase lg:block">Intelligence</p>
        {NAV.map((n) => (
          <NavLink key={n.href} {...n} />
        ))}
        <p className="hidden px-3.5 pt-4 pb-1 text-xs tracking-wider text-muted uppercase lg:block">Manage</p>
        {MANAGE.map((n) => (
          <NavLink key={n.href} {...n} />
        ))}
      </nav>

      <div className="mt-auto hidden rounded-2xl bg-gradient-to-br from-accent/30 to-accent2/25 p-4 ring-1 ring-line lg:block">
        <p className="text-xs tracking-wider text-soft uppercase">Monday brief</p>
        <p className="mt-1 text-sm text-ink">Delivered every Monday morning, IST, before recording.</p>
      </div>
    </aside>
  );
}
