import { CalendarDays, CircleUser, House, PiggyBank, UtensilsCrossed } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/utils'

const links = [
  { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
  { to: '/budget', label: 'Budget', icon: PiggyBank },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/account', label: 'Account', icon: CircleUser },
]

export function AppShell() {
  return (
    <div className="min-h-svh pb-28 sm:pb-0">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link to="/meals" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-float">
            <House className="size-5" aria-hidden />
          </span>
          HomeManager
        </Link>
        <nav
          aria-label="Main"
          className="fixed inset-x-3 bottom-3 z-40 flex gap-1 rounded-2xl border bg-card/90 p-1.5 shadow-float backdrop-blur sm:static sm:rounded-full"
        >
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:flex-row sm:gap-2 sm:rounded-full sm:px-4 sm:py-2 sm:text-sm',
                  isActive && 'bg-primary text-primary-foreground hover:text-primary-foreground',
                )
              }
            >
              <Icon className="size-5 sm:size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
