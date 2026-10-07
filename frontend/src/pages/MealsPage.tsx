import { Copy, Loader2, ShoppingCart, Sparkles, Users } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { DayDialog, fmtItem, longDate, SLOTS, type Item, type Meal, type Slot } from '@/components/DayDialog'
import { errorText } from '@/components/Field'
import { MonthNav } from '@/components/MonthNav'
import { PantryCard } from '@/components/PantryCard'
import { DIETS } from '@/components/ProfileFields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useUser } from '@/lib/auth'
import { addDays, currentMonth, monthGrid, today, weekStart } from '@/lib/month'
import { cn } from '@/lib/utils'

type ShoppingItem = Item & { category: string }
type Agent = 'generate' | 'shopping'
type DayMeals = Partial<Record<Slot, Meal>>

const CATEGORIES = ['produce', 'dairy', 'meat', 'seafood', 'bakery', 'pantry', 'frozen', 'beverages', 'other']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function weekLabel(start: string) {
  const end = addDays(start, 6)
  return `${shortDate(start)} – ${end.slice(5, 7) === start.slice(5, 7) ? Number(end.slice(8)) : shortDate(end)}`
}

function groupByCategory(items: ShoppingItem[]) {
  const category = (i: ShoppingItem) => (CATEGORIES.includes(i.category) ? i.category : 'other')
  return CATEGORIES.map((c) => [c, items.filter((i) => category(i) === c)] as const).filter(([, g]) => g.length)
}

function SectionCard({
  title,
  description,
  children,
  action,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  const id = `${title.replaceAll(' ', '-').toLowerCase()}-title`
  return (
    <Card role="region" aria-labelledby={id} className={cn('gap-4 animate-in fade-in slide-in-from-bottom-2', className)}>
      <CardHeader className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function DayCell({ day, meals, isToday, onOpen }: { day: string; meals: DayMeals; isToday: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={longDate(day)}
      aria-current={isToday ? 'date' : undefined}
      onClick={onOpen}
      className="group flex min-h-16 min-w-0 flex-col gap-1 rounded-xl border border-transparent bg-card p-1 text-left transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-30 sm:p-2"
    >
      <span
        className={cn(
          'grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums sm:text-sm',
          isToday ? 'bg-highlight text-highlight-foreground' : 'text-muted-foreground group-hover:text-foreground',
        )}
      >
        {Number(day.slice(8))}
      </span>
      {/* Phones: one dot per slot. */}
      <span className="flex flex-wrap gap-0.5 px-0.5 sm:hidden" aria-hidden>
        {SLOTS.map(({ slot, bg }) => (
          <span key={slot} className={cn('size-1.5 rounded-full', meals[slot] ? bg : 'bg-border')} />
        ))}
      </span>
      <span className="hidden w-full flex-col gap-0.5 sm:flex">
        {SLOTS.map(({ slot, icon: Icon, text }) => {
          const meal = meals[slot]
          return (
            <span key={slot} className="flex min-w-0 items-center gap-1 text-xs leading-5">
              <Icon className={cn('size-3 shrink-0', text, !meal && 'opacity-30')} aria-hidden />
              {meal ? (
                <span className="truncate" title={meal.name}>
                  {meal.name}
                </span>
              ) : (
                <span className="h-0 flex-1 border-t border-dashed border-border" />
              )}
            </span>
          )
        })}
      </span>
    </button>
  )
}

function MonthCard({
  month,
  onMonth,
  meals,
  week,
  onWeek,
  onOpen,
}: {
  month: string
  onMonth: (m: string) => void
  meals: Map<string, DayMeals>
  week: string
  onWeek: (w: string) => void
  onOpen: (day: string) => void
}) {
  const now = today()
  return (
    <Card role="region" aria-label="Month" className="order-1 gap-4 px-2 sm:px-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-4 px-2 sm:px-6">
        <h1>Meals</h1>
        <MonthNav month={month} onChange={onMonth} />
      </CardHeader>
      <CardContent className="space-y-1 px-0 sm:px-4">
        <div className="grid grid-cols-[1rem_repeat(7,minmax(0,1fr))] gap-1 text-center text-xs font-medium text-muted-foreground sm:grid-cols-[1.25rem_repeat(7,minmax(0,1fr))]">
          <span />
          {WEEKDAYS.map((d) => (
            <span key={d}>
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </span>
          ))}
        </div>
        {monthGrid(month).map((days) => {
          const start = weekStart(days.find(Boolean)!)
          const selected = start === week
          return (
            <div
              key={start}
              className={cn(
                'grid grid-cols-[1rem_repeat(7,minmax(0,1fr))] gap-1 rounded-2xl p-0.5 transition-colors sm:grid-cols-[1.25rem_repeat(7,minmax(0,1fr))] sm:p-1',
                selected ? 'bg-accent ring-1 ring-primary/25' : 'bg-muted/50',
              )}
            >
              <button
                type="button"
                aria-label={`Select week of ${shortDate(start)}`}
                aria-pressed={selected}
                title={`Week of ${shortDate(start)}`}
                onClick={() => onWeek(start)}
                className="group grid place-items-center rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span
                  className={cn(
                    'h-3/5 w-1 rounded-full transition-colors',
                    selected ? 'bg-primary' : 'bg-border group-hover:bg-primary/50',
                  )}
                />
              </button>
              {days.map((day, i) =>
                day ? (
                  <DayCell
                    key={day}
                    day={day}
                    meals={meals.get(day) ?? {}}
                    isToday={day === now}
                    onOpen={() => {
                      onWeek(start)
                      onOpen(day)
                    }}
                  />
                ) : (
                  <span key={i} />
                ),
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function HouseholdCard() {
  const { household_size: size, preferences: p } = useUser()
  const diet = p.diet !== 'none' && DIETS.find(([v]) => v === p.diet)?.[1]
  return (
    <SectionCard title="Household">
      <div className="space-y-3">
        <p className="flex items-center gap-2 font-medium">
          <Users className="size-4 text-primary" aria-hidden />
          {size === 1 ? '1 person' : `${size} people`}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {diet && <Badge>{diet}</Badge>}
          {p.allergies.map((a) => (
            <Badge key={a} variant="outline" className="border-destructive/40 text-destructive">
              No {a}
            </Badge>
          ))}
          {p.favorite_cuisines.map((c) => (
            <Badge key={c} variant="secondary">
              {c}
            </Badge>
          ))}
          <Badge variant="outline">{capitalize(p.cooking_time)} cooking</Badge>
        </div>
        <Link to="/account" className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          Edit household
        </Link>
      </div>
    </SectionCard>
  )
}

function GenerateDialog({ week, onClose, onGenerate }: { week: string; onClose: () => void; onGenerate: (slots: Slot[], overwrite: boolean) => void }) {
  const [slots, setSlots] = useState<Slot[]>(SLOTS.map((s) => s.slot))
  const [overwrite, setOverwrite] = useState(false)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Generate meals</DialogTitle>
          <DialogDescription>
            A week of meals for {weekLabel(week)}, based on your pantry and household preferences.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Meals to plan</legend>
          <div className="grid grid-cols-2 gap-2">
            {SLOTS.map(({ slot, label, icon: Icon, text }) => (
              <label key={slot} className="flex cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm has-checked:border-primary has-checked:bg-accent">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={slots.includes(slot)}
                  onChange={() => setSlots(slots.includes(slot) ? slots.filter((s) => s !== slot) : [...slots, slot])}
                />
                <Icon className={cn('size-4', text)} aria-hidden />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          Replace meals already planned
        </label>
        <DialogFooter>
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="rounded-full"
            disabled={!slots.length}
            // Keep the API's slot order regardless of click order.
            onClick={() => onGenerate(SLOTS.map((s) => s.slot).filter((s) => slots.includes(s)), overwrite)}
          >
            <Sparkles /> Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ShoppingListCard({ items }: { items: ShoppingItem[] }) {
  const [done, setDone] = useState<Set<number>>(new Set())
  const groups = groupByCategory(items)

  async function copy() {
    const text = groups.map(([c, g]) => [capitalize(c), ...g.map((i) => `- ${fmtItem(i)}`)].join('\n')).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Shopping list copied')
    } catch {
      toast.error('Copying is blocked in this browser')
    }
  }

  return (
    <SectionCard
      title="Shopping list"
      description={items.length ? `${items.length - done.size} of ${items.length} left to buy` : undefined}
      action={
        items.length > 0 && (
          <Button variant="outline" size="sm" className="rounded-full" onClick={copy}>
            <Copy /> Copy
          </Button>
        )
      }
    >
      {items.length === 0 && <p className="text-sm text-muted-foreground">Your pantry covers everything this week.</p>}
      <div className="columns-1 gap-6 sm:columns-2">
        {groups.map(([category, group]) => (
          <fieldset key={category} className="mb-4 break-inside-avoid">
            <legend className="mb-1.5 text-sm font-semibold">{capitalize(category)}</legend>
            {group.map((item) => {
              const n = items.indexOf(item)
              return (
                <label key={n} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm hover:bg-muted/60 has-checked:text-muted-foreground has-checked:line-through">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={done.has(n)}
                    onChange={() => setDone((d) => new Set(d.has(n) ? [...d].filter((x) => x !== n) : [...d, n]))}
                  />
                  {fmtItem(item)}
                </label>
              )
            })}
          </fieldset>
        ))}
      </div>
    </SectionCard>
  )
}

export function MealsPage() {
  const [month, setMonth] = useState(currentMonth)
  const [meals, setMeals] = useState<Meal[]>([])
  const [week, setWeek] = useState(() => weekStart(today()))
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [busy, setBusy] = useState<Agent | null>(null)
  const [needed, setNeeded] = useState<Item[] | null>(null)
  const [shopping, setShopping] = useState<ShoppingItem[] | null>(null)
  const [builds, setBuilds] = useState(0) // remounts the shopping card so check-offs reset

  const load = useCallback(async () => {
    try {
      setMeals(await api<Meal[]>(`/api/meals?month=${month}`))
    } catch (err) {
      toast.error(errorText(err))
    }
  }, [month])
  useEffect(() => void load(), [load])

  const byDay = new Map<string, DayMeals>()
  for (const m of meals) byDay.set(m.date, { ...byDay.get(m.date), [m.slot]: m })

  function selectWeek(w: string) {
    if (w === week) return
    setWeek(w)
    setNeeded(null)
    setShopping(null)
  }

  function changeMonth(m: string) {
    setMonth(m)
    selectWeek(weekStart(m === currentMonth() ? today() : `${m}-01`))
  }

  async function run(agent: Agent, call: () => Promise<void>) {
    setBusy(agent)
    try {
      await call()
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const generate = (slots: Slot[], overwrite: boolean) => {
    setGenerating(false)
    return run('generate', async () => {
      const saved = await api<Meal[]>('/api/meals/generate', { method: 'POST', json: { week_start: week, slots, overwrite } })
      await load()
      toast.success(saved.length ? `Added ${saved.length} meal${saved.length === 1 ? '' : 's'}` : 'Every slot was already planned')
    })
  }

  const shoppingList = () =>
    run('shopping', async () => {
      const r = await api<{ needed: { items: Item[] }; shopping: { items: ShoppingItem[] } }>('/api/meals/shopping-list', {
        method: 'POST',
        json: { week_start: week },
      })
      setNeeded(r.needed.items)
      setShopping(r.shopping.items)
      setBuilds((n) => n + 1)
    })

  const action = (agent: Agent, label: string, Icon: typeof Sparkles, onClick: () => void, primary = false) => (
    <Button
      variant={primary ? 'default' : 'outline'}
      className="w-full justify-start rounded-full"
      disabled={busy !== null}
      aria-busy={busy === agent}
      onClick={onClick}
    >
      {busy === agent ? <Loader2 className="animate-spin" /> : <Icon />} {label}
    </Button>
  )

  return (
    // Phones stack month, week actions, results, then household and pantry; desktop has a side column.
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="contents lg:block lg:space-y-6">
        <MonthCard month={month} onMonth={changeMonth} meals={byDay} week={week} onWeek={selectWeek} onOpen={setOpenDay} />
        <div className="order-3 space-y-6 empty:hidden">
          {shopping && <ShoppingListCard key={builds} items={shopping} />}
          {needed && (
          <SectionCard title="Groceries needed" description={`Everything the meals for ${weekLabel(week)} call for.`}>
            <ul className="columns-1 gap-6 text-sm sm:columns-2">
              {needed.map((i) => (
                <li key={i.name} className="py-0.5">
                  {fmtItem(i)}
                </li>
              ))}
            </ul>
          </SectionCard>
          )}
        </div>
      </div>

      <div className="contents lg:block lg:space-y-6">
        <SectionCard className="order-2" title={weekLabel(week)} description="Selected week. Pick another from the calendar.">
          <div className="space-y-2">
            {action('generate', 'Generate meals', Sparkles, () => setGenerating(true), true)}
            {action('shopping', 'Build shopping list', ShoppingCart, shoppingList)}
            {busy && (
              <p role="status" className="pt-1 text-sm text-muted-foreground">
                The meal assistant is working. This can take a minute.
              </p>
            )}
          </div>
        </SectionCard>
        <div className="order-4 space-y-6">
          <HouseholdCard />
          <PantryCard lastWeek={addDays(week, -7)} />
        </div>
      </div>

      {openDay && <DayDialog key={openDay} day={openDay} meals={byDay.get(openDay) ?? {}} onClose={() => setOpenDay(null)} onChanged={load} />}
      {generating && <GenerateDialog week={week} onClose={() => setGenerating(false)} onGenerate={generate} />}
    </div>
  )
}
