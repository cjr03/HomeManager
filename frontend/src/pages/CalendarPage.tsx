import { Check, Pencil, Plus, Square, SquareCheck, Trash2, Users } from 'lucide-react'
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
type CalTask = { id: number; owner_id: number; title: string; date: string; notes: string; shared: boolean; done: boolean }
type MonthData = { events: CalEvent[]; tasks: CalTask[]; chores: Occurrence[]; people: Person[] }
type Kind = 'event' | 'task'
const KIND_NAME = { event: 'Event', task: 'Task' }
type Recurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
type Chore = {
  id: number
  owner_id: number
  title: string
  notes: string
  start_date: string
  recurrence: Recurrence
  weekdays: number[] // Mon=0; empty means the start's weekday
  end_date: string | null
  shared: boolean
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
const DAYS_FROM_MONDAY = [...WEEKDAYS.slice(1), WEEKDAYS[0]] // indexed like the API's weekdays
const MAX_IN_CELL = 3

const longDay = (d: string) => formatDay(d, { weekday: 'long', month: 'long', day: 'numeric' })
const shortDay = (d: string) => formatDay(d, { month: 'short', day: 'numeric' })
const weekdayOf = (d: string) => (new Date(`${d}T00:00`).getDay() + 6) % 7
const hhmm = (t: string | null) => t?.slice(0, 5) ?? ''
const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 dark:scheme-dark [&>option]:bg-popover'

function describeChore(c: Chore) {
  if (c.recurrence === 'none') return `Once on ${shortDay(c.start_date)}`
  const every = REPEATS.find(([r]) => r === c.recurrence)![1]
  const on = c.weekdays.length ? ` on ${c.weekdays.map((d) => DAYS_FROM_MONDAY[d]).join(', ')}` : ''
  return `${every}${on} from ${shortDay(c.start_date)}${c.end_date ? ` until ${shortDay(c.end_date)}` : ''}`
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

function TaskPill({ task }: { task: CalTask }) {
  const Box = task.done ? SquareCheck : Square
  return (
    <li className="flex min-w-0 items-center gap-1 rounded-md border border-dashed border-primary/40 px-1 py-0.5 text-xs">
      <Box className="size-3 shrink-0 text-primary" aria-hidden />
      <span className={cn('truncate', task.done && 'text-muted-foreground line-through')}>{task.title}</span>
      {task.done && <span className="sr-only">, done</span>}
    </li>
  )
}

function ChorePill({ chore, assignee }: { chore: Occurrence; assignee?: Person }) {
  return (
    <li className="flex min-w-0 items-center gap-1 rounded-md border bg-card px-1 py-0.5 text-xs">
      {assignee && <UserAvatar username={assignee.username} avatar={assignee.avatar} className="size-4 text-[9px]" />}
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

function DayCell({
  day,
  events,
  tasks,
  chores,
  people,
  onOpen,
}: {
  day: string
  events: CalEvent[]
  tasks: CalTask[]
  chores: Occurrence[]
  people: Person[]
  onOpen: () => void
}) {
  const items = [
    ...events.map((e) => <EventPill key={`e${e.id}`} event={e} />),
    ...tasks.map((t) => <TaskPill key={`t${t.id}`} task={t} />),
    ...chores.map((c) => <ChorePill key={`c${c.chore_id}`} chore={c} assignee={people.find((p) => p.id === c.assignee_id)} />),
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
          {tasks.map((t) => (
            <span key={`t${t.id}`} className={cn('size-1.5 rounded-[2px] border border-primary', t.done && 'bg-primary/40')} />
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

function ShareToggle({ checked, onChange }: { checked: boolean; onChange: (shared: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary dark:scheme-dark"
      />
      Share with linked accounts
    </label>
  )
}

/** Adds or edits an event or a task. Only events have a time. */
function ItemForm({ kind, item, day, onDone }: { kind: Kind; item: CalEvent | CalTask | null; day: string; onDone: (saved: boolean) => void }) {
  const [form, setForm] = useState({
    title: item?.title ?? '',
    date: item?.date ?? day,
    start_time: item && 'start_time' in item ? hhmm(item.start_time) : '',
    notes: item?.notes ?? '',
    shared: item?.shared ?? false,
  })
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { start_time, ...rest } = form
    const json = { ...rest, title: form.title.trim(), ...(kind === 'event' && { start_time: start_time || null }) }
    try {
      await api(item ? `/api/${kind}s/${item.id}` : `/api/${kind}s`, { method: item ? 'PUT' : 'POST', json })
      toast.success(`${KIND_NAME[kind]} ${item ? 'updated' : 'added'}`)
      onDone(true)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-muted/60 p-4 animate-in fade-in slide-in-from-top-2">
      <Field id={`${kind}-title`} label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${kind}-date`} label="Date" type="date" className="dark:scheme-dark" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        {kind === 'event' && (
          <Field id="event-time" label="Time" type="time" className="dark:scheme-dark" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-notes`}>Notes</Label>
        <Textarea id={`${kind}-notes`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <ShareToggle checked={form.shared} onChange={(shared) => setForm({ ...form, shared })} />
      <FormError>{error}</FormError>
      <div className="flex gap-2">
        <Button type="submit" className="rounded-full">
          Save {kind}
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

/** Who shared someone else's event or task, or a Shared badge on mine. */
function SharedNote({ item, people }: { item: CalEvent | CalTask; people: Person[] }) {
  const me = useUser()
  if (item.owner_id !== me.id)
    return <p className="text-xs text-muted-foreground">Shared by {people.find((p) => p.id === item.owner_id)?.username ?? 'a linked account'}</p>
  return item.shared ? (
    <Badge variant="secondary" className="mt-1">
      <Users /> Shared
    </Badge>
  ) : null
}

function OwnerActions({ title, onEdit, onDelete }: { title: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex">
      <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={`Edit ${title}`} onClick={onEdit}>
        <Pencil />
      </Button>
      <Button size="icon-sm" variant="ghost" className="rounded-full text-destructive" aria-label={`Delete ${title}`} onClick={onDelete}>
        <Trash2 />
      </Button>
    </div>
  )
}

function DayDialog({
  day,
  data,
  people,
  onClose,
  onChanged,
  onToggled,
  onTaskToggled,
}: {
  day: string | null
  data: MonthData
  people: Person[]
  onClose: () => void
  onChanged: () => void
  onToggled: (chore: Occurrence, done: boolean) => void
  onTaskToggled: (task: CalTask, done: boolean) => void
}) {
  const me = useUser()
  const [editing, setEditing] = useState<{ kind: Kind; item: CalEvent | CalTask | null } | null>(null)
  const events = data.events.filter((e) => e.date === day)
  const tasks = data.tasks.filter((t) => t.date === day)
  const chores = data.chores.filter((c) => c.date === day)

  async function remove(kind: Kind, item: CalEvent | CalTask) {
    try {
      await api(`/api/${kind}s/${item.id}`, { method: 'DELETE' })
      toast.success(`${KIND_NAME[kind]} deleted`)
      onChanged()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  // Optimistic, like ChoreCheck: flip now, flip back if the save fails.
  async function toggle(task: CalTask, done: boolean) {
    onTaskToggled(task, done)
    try {
      await api(`/api/tasks/${task.id}/done`, { method: done ? 'POST' : 'DELETE' })
    } catch (err) {
      onTaskToggled(task, !done)
      toast.error(errorText(err))
    }
  }

  const formOrAdd = (kind: Kind) =>
    editing?.kind === kind ? (
      <ItemForm
        key={editing.item?.id ?? 'new'}
        kind={kind}
        item={editing.item}
        day={day!}
        onDone={(saved) => {
          setEditing(null)
          if (saved) onChanged()
        }}
      />
    ) : (
      <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing({ kind, item: null })}>
        <Plus /> Add {kind}
      </Button>
    )

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
          {!events.length && editing?.kind !== 'event' && <p className="text-sm text-muted-foreground">Nothing planned yet.</p>}
          <ul className="space-y-1">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-muted/60">
                <span className="w-11 shrink-0 pt-0.5 text-sm font-semibold text-primary tabular-nums">
                  {hhmm(e.start_time) || 'All day'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.title}</p>
                  {e.notes && <p className="text-sm whitespace-pre-line text-muted-foreground">{e.notes}</p>}
                  <SharedNote item={e} people={people} />
                </div>
                {e.owner_id === me.id && (
                  <OwnerActions title={e.title} onEdit={() => setEditing({ kind: 'event', item: e })} onDelete={() => remove('event', e)} />
                )}
              </li>
            ))}
          </ul>
          {formOrAdd('event')}
        </Section>
        <Section title="Tasks">
          {!tasks.length && editing?.kind !== 'task' && <p className="text-sm text-muted-foreground">No tasks.</p>}
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-muted/60">
                <input
                  type="checkbox"
                  aria-label={t.title}
                  checked={t.done}
                  onChange={(e) => void toggle(t, e.target.checked)}
                  className="mt-1 size-4 shrink-0 cursor-pointer accent-primary dark:scheme-dark"
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('font-medium transition-colors', t.done && 'text-muted-foreground line-through')}>{t.title}</p>
                  {t.notes && <p className="text-sm whitespace-pre-line text-muted-foreground">{t.notes}</p>}
                  <SharedNote item={t} people={people} />
                </div>
                {t.owner_id === me.id && (
                  <OwnerActions title={t.title} onEdit={() => setEditing({ kind: 'task', item: t })} onDelete={() => remove('task', t)} />
                )}
              </li>
            ))}
          </ul>
          {formOrAdd('task')}
        </Section>
        {chores.length > 0 && (
          <Section title="Chores">
            <ul>
              {chores.map((c) => (
                <li key={c.chore_id}>
                  <ChoreCheck chore={c} assignee={data.people.find((p) => p.id === c.assignee_id)} onChange={(done) => onToggled(c, done)} />
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
    weekdays: chore?.weekdays ?? [],
    end_date: chore?.end_date ?? '',
    notes: chore?.notes ?? '',
    shared: chore?.shared ?? false,
  })
  const [error, setError] = useState('')
  const onDays = form.weekdays.length || !form.start_date ? form.weekdays : [weekdayOf(form.start_date)]
  const toggleDay = (d: number) =>
    setForm({ ...form, weekdays: onDays.includes(d) ? onDays.filter((x) => x !== d) : [...onDays, d].sort() })
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
      {(form.recurrence === 'weekly' || form.recurrence === 'biweekly') && (
        <fieldset className="space-y-1.5">
          <legend className="text-sm leading-none font-medium">On</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS_FROM_MONDAY.map((name, d) => (
              <label
                key={name}
                className="cursor-pointer rounded-full border border-input px-3 py-1 text-sm transition-colors select-none has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
              >
                <input type="checkbox" className="sr-only" checked={onDays.includes(d)} onChange={() => toggleDay(d)} />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="chore-notes">Notes</Label>
        <Textarea id="chore-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <ShareToggle checked={form.shared} onChange={(shared) => setForm({ ...form, shared })} />
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
                <div className="flex items-center">
                  {c.shared && (
                    <Badge variant="secondary" className="mr-1">
                      <Users /> Shared
                    </Badge>
                  )}
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
  const [data, setData] = useState<MonthData>({ events: [], tasks: [], chores: [], people: [] })
  const [chores, setChores] = useState<Chore[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [openDay, setOpenDay] = useState<string | null>(null)
  // Kind outlives `open` so the dialog keeps its title and form while it animates closed.
  const [adding, setAdding] = useState<{ kind: Kind; open: boolean }>({ kind: 'event', open: false })
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

  const taskToggled = (task: CalTask, done: boolean) =>
    setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, done } : t)) }))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-4">
          <h1>Calendar</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setAdding({ kind: 'event', open: true })}>
              <Plus /> Add event
            </Button>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setAdding({ kind: 'task', open: true })}>
              <Plus /> Add task
            </Button>
            <MonthNav month={month} onChange={setMonth} />
          </div>
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
                    tasks={data.tasks.filter((t) => t.date === day)}
                    chores={data.chores.filter((c) => c.date === day)}
                    people={data.people}
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
      <DayDialog
        day={openDay}
        data={data}
        people={people}
        onClose={() => setOpenDay(null)}
        onChanged={reload}
        onToggled={toggled}
        onTaskToggled={taskToggled}
      />
      <Dialog open={adding.open} onOpenChange={(open) => setAdding({ ...adding, open })}>
        <DialogContent aria-describedby={undefined} className="max-h-[90svh] overflow-y-auto rounded-2xl bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">New {adding.kind}</DialogTitle>
          </DialogHeader>
          <ItemForm
            kind={adding.kind}
            item={null}
            day={month === currentMonth() ? today() : `${month}-01`}
            onDone={(saved) => {
              setAdding({ ...adding, open: false })
              if (saved) reload()
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
