import { CalendarDays, CircleUser, House, LogOut, PiggyBank, UtensilsCrossed } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { AssistantPanel } from '@/components/AssistantPanel'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { useAuth, useUser } from '@/lib/auth'
import { cn } from '@/lib/utils'

const links = [
  { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
  { to: '/budget', label: 'Budget', icon: PiggyBank },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/account', label: 'Account', icon: CircleUser },
]

export function AppShell() {
  const user = useUser()
  const { logout } = useAuth()
  return (
    <div className="min-h-svh pb-28 sm:pb-0">
      <header className="mx-auto flex max-w-6xl xl:max-w-[96rem] items-center justify-between gap-4 px-4 py-5 sm:px-6">
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
        <div className="flex items-center gap-1">
          <Link
            to="/account"
            aria-label={`Signed in as ${user.username}`}
            className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-medium transition-colors hover:bg-accent"
          >
            <UserAvatar username={user.username} avatar={user.avatar} className="size-8" />
            <span className="hidden md:inline">{user.username}</span>
          </Link>
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="Log out" title="Log out" onClick={logout}>
            <LogOut />
          </Button>
        </div>
      </header>
      {/* xl screens: the page plus a sticky assistant column, keeping the page at max-w-6xl. */}
      <div className="mx-auto max-w-6xl items-start gap-6 px-4 pb-10 sm:px-6 xl:grid xl:max-w-[96rem] xl:grid-cols-[minmax(0,1fr)_18rem]">
        <main className="min-w-0">
          <Outlet />
        </main>
        <AssistantPanel />
      </div>
    </div>
  )
}
