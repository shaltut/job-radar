"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import { isPublicPath } from "@/lib/auth-paths"
import {
  Search,
  SlidersHorizontal,
  GraduationCap,
  BarChart3,
  Gauge,
  Settings,
  Shield,
  LogOut,
} from "lucide-react"

const navItems = [
  { name: "Jobs", href: "/", icon: Search },
  { name: "Discovery", href: "/discovery", icon: SlidersHorizontal },
  { name: "Skills", href: "/skills", icon: GraduationCap },
  { name: "Insights", href: "/insights", icon: BarChart3 },
  { name: "Apify", href: "/apify", icon: Gauge },
  { name: "Settings", href: "/settings", icon: Settings },
]

// #129: owner-only, so it's appended conditionally rather than living in the
// static navItems list above (which every signed-in user sees).
const adminNavItem = { name: "Admin", href: "/admin/users", icon: Shield }

export function JobsShell({ children, isOwner = false }: { children: React.ReactNode; isOwner?: boolean }) {
  const pathname = usePathname()

  if (isPublicPath(pathname)) {
    return <>{children}</>
  }

  const items = isOwner ? [...navItems, adminNavItem] : navItems

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 flex w-[200px] flex-col bg-[#0b1120]">
        {/* Logo */}
        <div className="flex h-14 items-center justify-between border-b border-white/[0.08] px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-white font-bold text-sm shrink-0">
              J
            </div>
            <span className="text-sm font-semibold text-white whitespace-nowrap">Job Radar</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {items.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-[#1e293b] text-emerald-400"
                    : "text-slate-400 hover:bg-[#1e293b]/50 hover:text-white"
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.name}</span>
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="border-t border-white/[0.08] py-2 px-2">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-[#1e293b]/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 ring-emerald-500/60"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span className="truncate">Log out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-h-screen md:ml-[200px]">
        <div className="p-4 md:p-6 max-w-[1700px] mx-auto">{children}</div>
      </main>
    </>
  )
}
