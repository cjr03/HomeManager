import { Check, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useEffect, useReducer, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ChoreCheck, type Occurrence, type Person } from '@/components/ChoreCheck'
import { errorText, Field, FormError } from '@/components/Field'
import { MonthNav } from '@/components/MonthNav'
import { UserAvatar } from '@/components/UserAvatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { useUser } from '@/lib/auth'
import { currentMonth, formatDay, monthGrid, today } from '@/lib/month'
import { cn } from '@/lib/utils'

type CalEvent = { id: number; owner_id: number; title: string; date: string; start_time: string | null; notes: string; shared: boolean }
type MonthData = { events: CalEvent[]; chores: Occurrence[] }
type Recurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
type Chore = {
  id: number
  owner_id: number
  title: string
  notes: string
  start_date: string
  recurrence: Recurrence
  end_date: string | null
  assignee: Person
}

const REPEATS: [Recurrence, string][] = [
  ['none', 'Once'],
  ['daily', 'Every day'],
  ['weekly', 'Every week'],
  ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Every month'],
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_IN_CELL = 3

const longDay = (d: string) => formatDay(d, { weekday: 'long', month: 'long', day: 'numeric' })
const shortDay = (d: string) => formatDay(d, { month: 'short', day: 'numeric' })
const hhmm = (t: string | null) => t?.slice(0, 5) ?? ''
const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 dark:scheme-dark [&>option]:bg-popover'

function describeChore(c: Chore) {
  if (c.recurrence === 'none') return `Once on ${shortDay(c.start_date)}`
  const every = REPEATS.find(([r]) => r === c.recurrence)![1]
  return `${every} from ${shortDay(c.start_date)}${c.end_date ? ` until ${shortDay(c.end_date)}` : ''}`
}

// ---- month grid ----

function EventPill({ event }: { event: CalEvent }) {
  return (
    <li className="flex min-w-0 items-center gap-1 rounded-md bg-primary/12 px-1.5 py-0.5 text-xs text-accent-foreground">
      {event.start_time && <span className="font-semibold tabular-nums">{hhmm(event.start_time)}</span>}
      <span className="truncate">{event.title}</span>
    </li>
  )
}

function ChorePill({ chore }: { chore: Occurrence }) {
  return (
    <li className="flex min-w-0 items-center gap-1 rounded-md border bg-card px-1 py-0.5 text-xs">
      <UserAvatar username={chore.assignee.username} avatar={chore.assignee.avatar} className="size-4 text-[9px]" />
      <span className={cn('truncate', chore.done && 'text-muted-foreground line-through')}>{chore.title}</span>
      {chore.done && (
        <>
          <Check className="ml-auto size-3 shrink-0 text-primary" aria-hidden />
          <span className="sr-only">, done</span>
        </>
      )}
    </li>
  )
}

function DayCell({ day, events, chores, onOpen }: { day: string; events: CalEvent[]; chores: Occurrence[]; onOpen: () => void }) {
  const items = [
    ...events.map((e) => <EventPill key={`e${e.id}`} event={e} />),
    ...chores.map((c) => <ChorePill key={`c${c.chore_id}`} chore={c} />),
  ]
  const shown = items.length > MAX_IN_CELL ? MAX_IN_CELL - 1 : items.length
  return (
    <button
      type="button"
      aria-label={longDay(day)}
      aria-current={day === today() ? 'date' : undefined}
      onClick={onOpen}
      className="group flex min-h-16 min-w-0 flex-col gap-1 rounded-xl border border-transparent bg-muted/50 p-1 text-left transition-colors outline-none hover:border-primary/30 hover:bg-accent/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=date]:border-highlight/70 aria-[current=date]:bg-highlight/10 sm:min-h-28 sm:p-1.5"
    >
      <span className="grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums group-aria-[current=date]:bg-highlight group-aria-[current=date]:text-highlight-foreground">
        {Number(day.slice(8))}
      </span>
      <ul className="hidden min-w-0 flex-col gap-0.5 sm:flex">
        {items.slice(0, shown)}
        {shown < items.length && <li className="px-1 text-xs font-medium text-muted-foreground">+{items.length - shown} more</li>}
      </ul>
      {items.length > 0 && (
        <span aria-hidden className="mt-auto flex flex-wrap gap-0.5 px-0.5 sm:hidden">
          {events.map((e) => (
            <span key={`e${e.id}`} className="size-1.5 rounded-full bg-primary" />
          ))}
          {chores.map((c) => (
            <span key={`c${c.chore_id}`} className={cn('size-1.5 rounded-full border border-primary', c.done && 'bg-primary/40')} />
          ))}
        </span>
      )}
    </button>
  )
}

// ---- day dialog ----

function EventForm({ event, day, onDone }: { event: CalEvent | null; day: string; onDone: (saved: boolean) => void }) {
  const [form, setForm] = useState({
    title: event?.title ?? '',
    start_time: hhmm(event?.start_time ?? null),
    notes: event?.notes ?? '',
    shared: event?.shared ?? false,
  })
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const json = { ...form, title: form.title.trim(), date: day, start_time: form.start_time || null }
    try {
      await api(event ? `/api/events/${event.id}` : '/api/events', { method: event ? 'PUT' : 'POST', json })
      toast.success(event ? 'Event updated' : 'Event added')
      onDone(true)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-muted/60 p-4 animate-in fade-in slide-in-from-top-2">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field id="event-title" label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Field id="event-time" label="Time" type="time" className="dark:scheme-dark" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="event-notes">Notes</Label>
        <Textarea id="event-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.shared}
          onChange={(e) => setForm({ ...form, shared: e.target.checked })}
          className="size-4 accent-primary dark:scheme-dark"
        />
        Share with linked accounts
      </label>
      <FormError>{error}</FormError>
      <div className="flex gap-2">
        <Button type="submit" className="rounded-full">
          Save event
        </Button>
        <Button type="button" variant="ghost" className="rounded-full" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function DayDialog({
  day,
  data,
  people,
  onClose,
  onChanged,
  onToggled,
}: {
  day: string | null
  data: MonthData
  people: Person[]
  onClose: () => void
  onChanged: () => void
  onToggled: (chore: Occurrence, done: boolean) => void
}) {
  const me = useUser()
  const [editing, setEditing] = useState<CalEvent | 'new' | null>(null)
  const events = data.events.filter((e) => e.date === day)
  const chores = data.chores.filter((c) => c.date === day)

  async function remove(event: CalEvent) {
    try {
      await api(`/api/events/${event.id}`, { method: 'DELETE' })
      toast.success('Event deleted')
      onChanged()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  return (
    <Dialog
      open={day !== null}
      onOpenChange={(open) => {
        if (!open) {
          setEditing(null)
          onClose()
        }
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-h-[90svh] overflow-y-auto rounded-2xl bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{day && longDay(day)}</DialogTitle>
        </DialogHeader>
        <Section title="Events">
          {!events.length && !editing && <p className="text-sm text-muted-foreground">Nothing planned yet.</p>}
          <ul className="space-y-1">
            {events.map((e) => {
              const mine = e.owner_id === me.id
              return (
                <li key={e.id} className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-muted/60">
                  <span className="w-11 shrink-0 pt-0.5 text-sm font-semibold text-primary tabular-nums">
                    {hhmm(e.start_time) || 'All day'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{e.title}</p>
                    {e.notes && <p className="text-sm whitespace-pre-line text-muted-foreground">{e.notes}</p>}
                    {!mine ? (
                      <p className="text-xs text-muted-foreground">
                        Shared by {people.find((p) => p.id === e.owner_id)?.username ?? 'a linked account'}
                      </p>
                    ) : (
                      e.shared && (
                        <Badge variant="secondary" className="mt-1">
                          <Users /> Shared
                        </Badge>
                      )
                    )}
                  </div>
                  {mine && (
                    <div className="flex">
                      <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={`Edit ${e.title}`} onClick={() => setEditing(e)}>
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="rounded-full text-destructive"
                        aria-label={`Delete ${e.title}`}
                        onClick={() => remove(e)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {editing ? (
            <EventForm
              key={editing === 'new' ? 'new' : editing.id}
              event={editing === 'new' ? null : editing}
              day={day!}
              onDone={(saved) => {
                setEditing(null)
                if (saved) onChanged()
              }}
            />
          ) : (
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing('new')}>
              <Plus /> Add event
            </Button>
          )}
        </Section>
        {chores.length > 0 && (
          <Section title="Chores">
            <ul>
              {chores.map((c) => (
                <li key={c.chore_id}>
                  <ChoreCheck chore={c} onChange={(done) => onToggled(c, done)} />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---- chores ----

function ChoreForm({ chore, people, onDone }: { chore: Chore | null; people: Person[]; onDone: (saved: boolean) => void }) {
  const me = useUser()
  const [form, setForm] = useState({
    title: chore?.title ?? '',
    assignee_id: chore?.assignee.id ?? me.id,
    start_date: chore?.start_date ?? today(),
    recurrence: chore?.recurrence ?? ('none' as Recurrence),
    end_date: chore?.end_date ?? '',
    notes: chore?.notes ?? '',
  })
  const [error, setError] = useState('')
  // Keep a since-unlinked assignee selectable so editing doesn't silently reassign.
  const assignees = [...people, ...(chore && chore.assignee.id !== me.id && !people.some((p) => p.id === chore.assignee.id) ? [chore.assignee] : [])]

  async function submit(e: FormEvent) {
    e.preventDefault()
    const json = { ...form, title: form.title.trim(), end_date: form.end_date || null }
    try {
      await api(chore ? `/api/chores/${chore.id}` : '/api/chores', { method: chore ? 'PUT' : 'POST', json })
      toast.success(chore ? 'Chore updated' : 'Chore added')
      onDone(true)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-3 rounded-xl bg-muted/60 p-4 animate-in fade-in slide-in-from-top-2">
      <Field id="chore-title" label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="chore-assignee">Assignee</Label>
          <select
            id="chore-assignee"
            className={selectClass}
            value={form.assignee_id}
            onChange={(e) => setForm({ ...form, assignee_id: Number(e.target.value) })}
          >
            <option value={me.id}>You ({me.username})</option>
            {assignees.map((p) => (
              <option key={p.id} value={p.id}>
                {p.username}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="chore-repeats">Repeats</Label>
          <select
            id="chore-repeats"
            className={selectClass}
            value={form.recurrence}
            onChange={(e) => setForm({ ...form, recurrence: e.target.value as Recurrence })}
          >
            {REPEATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Field id="chore-start" label="Starts" type="date" className="dark:scheme-dark" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        <Field
          id="chore-end"
          label="Ends (optional)"
          type="date"
          className="dark:scheme-dark"
          min={form.start_date}
          disabled={form.recurrence === 'none'}
          value={form.end_date}
          onChange={(e) => setForm({ ...form, end_date: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="chore-notes">Notes</Label>
        <Textarea id="chore-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <FormError>{error}</FormError>
      <div className="flex gap-2">
        <Button type="submit" className="rounded-full">
          Save chore
        </Button>
        <Button type="button" variant="ghost" className="rounded-full" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ChoresCard({ chores, people, onChanged }: { chores: Chore[]; people: Person[]; onChanged: () => void }) {
  const me = useUser()
  const [editing, setEditing] = useState<Chore | 'new' | null>(null)

  async function remove(chore: Chore) {
    try {
      await api(`/api/chores/${chore.id}`, { method: 'DELETE' })
      toast.success('Chore deleted')
      onChanged()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">Chores</h2>
          <CardDescription>Who does what, and how often.</CardDescription>
        </div>
        {!editing && (
          <Button size="sm" className="rounded-full" onClick={() => setEditing('new')}>
            <Plus /> New chore
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing && (
          <ChoreForm
            key={editing === 'new' ? 'new' : editing.id}
            chore={editing === 'new' ? null : editing}
            people={people}
            onDone={(saved) => {
              setEditing(null)
              if (saved) onChanged()
            }}
          />
        )}
        {!chores.length && !editing && <p className="text-sm text-muted-foreground">No chores yet. Add one and pick who does it.</p>}
        <ul className="grid gap-1 md:grid-cols-2">
          {chores.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60">
              <UserAvatar username={c.assignee.username} avatar={c.assignee.avatar} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.title}</p>
                <p className="truncate text-xs text-muted-foreground">{describeChore(c)}</p>
              </div>
              {c.owner_id === me.id ? (
                <div className="flex">
                  <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={`Edit ${c.title}`} onClick={() => setEditing(c)}>
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full text-destructive"
                    aria-label={`Delete ${c.title}`}
                    onClick={() => remove(c)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : (
                <Badge variant="secondary">From {people.find((p) => p.id === c.owner_id)?.username ?? 'a linked account'}</Badge>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// ---- page ----

export function CalendarPage() {
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState<MonthData>({ events: [], chores: [] })
  const [chores, setChores] = useState<Chore[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [version, reload] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    let live = true
    api<MonthData>(`/api/calendar/${month}`)
      .then((d) => live && setData(d))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [month, version])

  useEffect(() => {
    api<Chore[]>('/api/chores')
      .then(setChores)
      .catch(() => {})
  }, [version])

  useEffect(() => {
    api<{ linked: { user_id: number; username: string; avatar: string | null }[] }>('/api/links')
      .then((l) => setPeople(l.linked.map(({ user_id, username, avatar }) => ({ id: user_id, username, avatar }))))
      .catch(() => {})
  }, [])

  const toggled = (chore: Occurrence, done: boolean) =>
    setData((d) => ({
      ...d,
      chores: d.chores.map((c) => (c.chore_id === chore.chore_id && c.date === chore.date ? { ...c, done } : c)),
    }))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-4">
          <h1>Calendar</h1>
          <MonthNav month={month} onChange={setMonth} />
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEKDAYS.map((w) => (
              <div key={w} className="pb-1 text-center text-xs font-medium text-muted-foreground">
                {w}
              </div>
            ))}
            {monthGrid(month)
              .flat()
              .map((day, i) =>
                day ? (
                  <DayCell
                    key={day}
                    day={day}
                    events={data.events.filter((e) => e.date === day)}
                    chores={data.chores.filter((c) => c.date === day)}
                    onOpen={() => setOpenDay(day)}
                  />
                ) : (
                  <div key={`pad${i}`} aria-hidden />
                ),
              )}
          </div>
        </CardContent>
      </Card>
      <ChoresCard chores={chores} people={people} onChanged={reload} />
      <DayDialog day={openDay} data={data} people={people} onClose={() => setOpenDay(null)} onChanged={reload} onToggled={toggled} />
    </div>
  )
}
