import { CircleAlert, CircleCheck, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type Kind = 'asset' | 'debit' | 'income' | 'loan' | 'credit' | 'expense' | 'savings'
export type Line = { id: number; owner_id: number; month: string; kind: Kind; name: string; a: string; b: string | null; position: number }
export type LineInput = { name: string; a: string; b: string | null }
export type Member = { id: number; username: string; avatar: string | null }
type Plan = { budgeted: string; actual: string; difference: string }
type Balances = { start: string; end: string; difference: string }
export type Summary = {
  assets: string
  debit: Balances
  income: { pre_tax: string; post_tax: string }
  loans: string
  credit: Balances
  expenses: Plan
  savings: Plan
  remainder: Plan
  net_worth: string
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const signedUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' })
export const money = (v: string | number) => usd.format(Number(v))
export const signedMoney = (v: string | number) => signedUsd.format(Number(v))

export const TONE_LABEL = { good: 'On track or better', bad: 'Needs attention' }

/** A signed difference whose colour, icon and hidden label say whether the change is good for the user. */
export function Delta({ value, better = 'up' }: { value: string; better?: 'up' | 'down' }) {
  const n = Number(value)
  const tone = n === 0 ? 'neutral' : n > 0 === (better === 'up') ? 'good' : 'bad'
  const Icon = tone === 'bad' ? CircleAlert : CircleCheck
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 font-semibold tabular-nums',
        { good: 'text-primary', bad: 'text-destructive', neutral: 'text-muted-foreground' }[tone],
      )}
    >
      {tone !== 'neutral' && <Icon className="size-[1em] shrink-0" aria-hidden />}
      {signedMoney(value)}
      {tone !== 'neutral' && <span className="sr-only">{TONE_LABEL[tone]}</span>}
    </span>
  )
}

type Config = {
  title: string
  noun: string
  hint: string
  cols: string[]
  negative?: boolean
  totals: (s: Summary) => string[]
  change?: (s: Summary) => { label: string; value: string; better: 'up' | 'down' }
  meter?: string
}

const KINDS: Record<Kind, Config> = {
  asset: { title: 'Assets', noun: 'asset', hint: 'Home, car, investments', cols: ['Value'], totals: (s) => [s.assets] },
  debit: {
    title: 'Debit accounts',
    noun: 'debit account',
    hint: 'Balances on the first and last day',
    cols: ['Month begin', 'Month end'],
    negative: true,
    totals: (s) => [s.debit.start, s.debit.end],
    change: (s) => ({ label: 'Change this month', value: s.debit.difference, better: 'up' }),
  },
  income: { title: 'Income', noun: 'income', hint: 'Before and after tax', cols: ['Pre-tax', 'Post-tax'], totals: (s) => [s.income.pre_tax, s.income.post_tax] },
  loan: { title: 'Loans', noun: 'loan', hint: 'Mortgage, car and student loans', cols: ['Amount owed'], totals: (s) => [s.loans] },
  credit: {
    title: 'Credit accounts',
    noun: 'credit card',
    hint: 'Balances on the first and last day',
    cols: ['Month begin', 'Month end'],
    negative: true,
    totals: (s) => [s.credit.start, s.credit.end],
    change: (s) => ({ label: 'Change this month', value: s.credit.difference, better: 'down' }),
  },
  expense: {
    title: 'Expenses',
    noun: 'expense',
    hint: 'Budgeted against what you spent',
    cols: ['Budgeted', 'Actual'],
    totals: (s) => [s.expenses.budgeted, s.expenses.actual],
    change: (s) => ({ label: 'Versus budget', value: s.expenses.difference, better: 'up' }),
    meter: 'spent of budget',
  },
  savings: {
    title: 'Savings',
    noun: 'savings',
    hint: 'Planned against what you put away',
    cols: ['Budgeted', 'Actual'],
    totals: (s) => [s.savings.budgeted, s.savings.actual],
    change: (s) => ({ label: 'Versus goal', value: s.savings.difference, better: 'up' }),
    meter: 'saved of goal',
  },
}

// Rows stack name over amounts in narrow cards and become one aligned row from 28rem of card width.
// The last column holds the edit/delete buttons, so read-only cards leave it out.
const ROW = {
  editable: { 1: '@md:grid-cols-[minmax(0,1fr)_7rem_4.25rem]', 2: '@md:grid-cols-[minmax(0,1fr)_repeat(2,7rem)_4.25rem]' },
  readOnly: { 1: '@md:grid-cols-[minmax(0,1fr)_7rem]', 2: '@md:grid-cols-[minmax(0,1fr)_repeat(2,7rem)]' },
}

function Amounts({ values, labels }: { values: (string | null)[]; labels: string[] }) {
  return (
    <div className={cn('col-span-full row-start-2 grid gap-x-3 @md:contents', values.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
      {values.map((v, i) => (
        <span key={labels[i]} className="flex items-baseline justify-between gap-2 tabular-nums @md:justify-end">
          <span className="text-xs font-normal text-muted-foreground @md:sr-only">{labels[i]}</span>
          {v === null ? <span className="text-muted-foreground">–</span> : money(v)}
        </span>
      ))}
    </div>
  )
}

function Meter({ name, label, budgeted, actual, over }: { name: string; label: string; budgeted: number; actual: number; over: boolean }) {
  const pct = budgeted > 0 ? Math.min(actual / budgeted, 1) * 100 : actual > 0 ? 100 : 0
  return (
    <div
      role="meter"
      aria-label={`${name} ${label}`}
      aria-valuemin={0}
      aria-valuemax={budgeted}
      aria-valuenow={actual}
      className={cn('col-span-full h-1.5 overflow-hidden rounded-full', over ? 'bg-destructive/15' : 'bg-primary/15')}
    >
      <div className={cn('h-full rounded-full', over ? 'bg-destructive' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  )
}

function LineForm({ config, initial, onSave, onCancel }: { config: Config; initial?: Line; onSave: (v: LineInput) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [a, setA] = useState(initial?.a ?? '')
  const [b, setB] = useState(initial?.b ?? '')

  function submit(e: FormEvent) {
    e.preventDefault()
    onSave({ name: name.trim(), a, b: config.cols.length === 2 && b !== '' ? b : null })
  }

  const amount = (label: string, value: string, set: (v: string) => void, required: boolean) => (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        min={config.negative ? undefined : 0}
        required={required}
        className="tabular-nums"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  )

  return (
    <form onSubmit={submit} className="animate-in space-y-3 rounded-xl bg-muted/60 p-3 fade-in">
      <div className={cn('grid gap-2', config.cols.length === 2 ? 'grid-cols-2 @md:grid-cols-[1fr_7rem_7rem]' : 'grid-cols-[1fr_7rem]')}>
        <label className={cn('grid gap-1 text-xs text-muted-foreground', config.cols.length === 2 && 'col-span-2 @md:col-span-1')}>
          Name
          <Input required maxLength={100} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {amount(config.cols[0], a, setA, true)}
        {config.cols[1] && amount(config.cols[1], b, setB, false)}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="rounded-full">
          Save
        </Button>
      </div>
    </form>
  )
}

type Props = {
  kind: Kind
  lines: Line[]
  summary: Summary
  /** Shared view: tag each row with its owner. Cards without handlers are read-only. */
  owners?: Record<number, Member>
  onAdd?: (v: LineInput) => void
  onUpdate?: (id: number, v: LineInput) => void
  onDelete?: (id: number) => void
}

export function BudgetCard({ kind, lines, summary, owners, onAdd, onUpdate, onDelete }: Props) {
  const config = KINDS[kind]
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const editable = !!onAdd
  const row = cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5', ROW[editable ? 'editable' : 'readOnly'][config.cols.length as 1 | 2])
  const change = config.change?.(summary)

  return (
    <Card className="@container gap-4">
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{config.title}</h3>
          <CardDescription>{config.hint}</CardDescription>
        </div>
        {editable && editing !== 'new' && (
          <Button size="sm" variant="outline" className="shrink-0 rounded-full" onClick={() => setEditing('new')}>
            <Plus /> Add {config.noun}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div aria-hidden className={cn(row, 'hidden text-xs text-muted-foreground @md:grid')}>
          <span />
          {config.cols.map((c) => (
            <span key={c} className="text-right">
              {c}
            </span>
          ))}
        </div>
        <ul className="divide-y divide-border/70">
          {lines.map((line) =>
            editing === line.id ? (
              <li key={line.id} className="py-2">
                <LineForm
                  config={config}
                  initial={line}
                  onCancel={() => setEditing(null)}
                  onSave={(v) => {
                    setEditing(null)
                    onUpdate?.(line.id, v)
                  }}
                />
              </li>
            ) : (
              <li key={line.id} aria-label={line.name} className={cn(row, 'py-2.5')}>
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  {owners?.[line.owner_id] && (
                    <span title={owners[line.owner_id].username} className="shrink-0">
                      <UserAvatar {...owners[line.owner_id]} className="size-6 text-xs" />
                    </span>
                  )}
                  <span className="truncate">{line.name}</span>
                </span>
                <Amounts values={config.cols.length === 2 ? [line.a, line.b] : [line.a]} labels={config.cols} />
                {editable && (
                  <span className="col-start-2 row-start-1 flex justify-end gap-0.5 @md:col-start-auto @md:row-start-auto">
                    <Button size="icon-sm" variant="ghost" className="rounded-full text-muted-foreground" aria-label={`Edit ${line.name}`} onClick={() => setEditing(line.id)}>
                      <Pencil />
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="rounded-full text-muted-foreground hover:text-destructive" aria-label={`Delete ${line.name}`} onClick={() => onDelete?.(line.id)}>
                      <Trash2 />
                    </Button>
                  </span>
                )}
                {config.meter && (
                  <Meter
                    name={line.name}
                    label={config.meter}
                    budgeted={Number(line.a)}
                    actual={Number(line.b ?? 0)}
                    over={kind === 'expense' && Number(line.b ?? 0) > Number(line.a)}
                  />
                )}
              </li>
            ),
          )}
        </ul>
        {!lines.length && editing !== 'new' && (
          <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        )}
        {editing === 'new' && (
          <LineForm
            config={config}
            onCancel={() => setEditing(null)}
            onSave={(v) => {
              setEditing(null)
              onAdd?.(v)
            }}
          />
        )}
        <div className="space-y-1.5 border-t pt-3 text-sm">
          <div className={cn(row, 'font-semibold')}>
            <span>Total</span>
            <Amounts values={config.totals(summary)} labels={config.cols} />
          </div>
          {change && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{change.label}</span>
              <Delta value={change.value} better={change.better} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
