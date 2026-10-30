"use client";

import {
  Activity,
  AudioWaveform,
  BarChart3,
  FileText,
  FlaskConical,
  GitCompare,
  Headphones,
  LayoutDashboard,
  Menu,
  Settings,
  SlidersHorizontal,
  Waves,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { loadStoredSettings } from "@/stores/settings-store";
import { ImportErrorBanner } from "./ImportErrorBanner";
import { TopBar } from "./TopBar";

const LINKS: ReadonlyArray<{ href: string; label: string; short: string; icon: LucideIcon }> = [
  { href: "/", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { href: "/workspace", label: "Audio Workspace", short: "Workspace", icon: AudioWaveform },
  { href: "/signal", label: "Signal Analysis", short: "Signal", icon: BarChart3 },
  { href: "/spectral", label: "Spectral Analysis", short: "Spectral", icon: Waves },
  { href: "/stereo", label: "Stereo Analysis", short: "Stereo", icon: Headphones },
  { href: "/insights", label: "Events and Pitch", short: "Events", icon: Activity },
  { href: "/filters", label: "Filter Laboratory", short: "Filters", icon: SlidersHorizontal },
  { href: "/compare", label: "Comparison Lab", short: "Compare", icon: GitCompare },
  { href: "/reports", label: "Reports", short: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings },
];

/** The bar has room for a few destinations; the rest open from More. */
const PHONE_BAR_LINKS = 3;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = LINKS.slice(PHONE_BAR_LINKS).some(({ href }) => href === pathname);

  useEffect(loadStoredSettings, []);

  useEffect(() => {
    const page = LINKS.find(({ href }) => href === pathname)?.label;
    document.title = page ? `${page} · ECHOFORM` : "ECHOFORM";
  }, [pathname]);

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-1.5 focus:text-sm focus:text-deep"
      >
        Skip to content
      </a>
      <nav
        aria-label="Primary"
        className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface md:flex"
      >
        <Link href="/" className="flex items-center gap-2 px-4 py-4">
          <FlaskConical className="size-5 text-accent" aria-hidden />
          <span className="text-sm font-semibold tracking-[0.18em]">ECHOFORM</span>
        </Link>
        <ul className="space-y-0.5 px-2 pb-3">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${
                  pathname === href
                    ? "bg-raised text-ink"
                    : "text-muted hover:bg-raised/60 hover:text-ink"
                }`}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar />
        <ImportErrorBanner />
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-auto outline-none">
          {children}
        </main>
        <nav aria-label="Primary" className="border-t border-line bg-surface md:hidden">
          {moreOpen && (
            <ul id="more-pages" className="grid grid-cols-2 gap-px border-b border-line bg-line">
              {LINKS.slice(PHONE_BAR_LINKS).map(({ href, label, icon: Icon }) => (
                <li key={href} className="bg-surface">
                  <Link
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={pathname === href ? "page" : undefined}
                    className={`flex items-center gap-2 px-3 py-3 text-sm ${
                      pathname === href ? "text-accent" : "text-muted"
                    }`}
                  >
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex">
            {LINKS.slice(0, PHONE_BAR_LINKS).map(({ href, short, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                aria-current={pathname === href ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                  pathname === href ? "text-accent" : "text-muted"
                }`}
              >
                <Icon className="size-4" aria-hidden />
                {short}
              </Link>
            ))}
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls="more-pages"
              onClick={() => setMoreOpen(!moreOpen)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                inMore || moreOpen ? "text-accent" : "text-muted"
              }`}
            >
              <Menu className="size-4" aria-hidden />
              More
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
