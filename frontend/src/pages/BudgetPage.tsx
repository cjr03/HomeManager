import { CircleAlert, CircleCheck, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { BudgetCard, Delta, money, TONE_LABEL, type Kind, type Line, type LineInput, type Member, type Summary } from '@/components/BudgetCard'
import { errorText, FormError } from '@/components/Field'
import { MonthNav } from '@/components/MonthNav'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { currentMonth, monthLabel } from '@/lib/month'

type MonthData = { lines: Line[]; summary: Summary }
type SharedData = MonthData & { members: Member[]; per_member: { user_id: number; summary: Summary }[] }
type LinkEntry = { id: number; user_id: number; username: string; avatar: string | null }

const SECTIONS: { title: string; kinds: Kind[]; grid: string }[] = [
  { title: 'What you own', kinds: ['asset', 'debit'], grid: 'lg:grid-cols-2' },
  { title: 'What you owe', kinds: ['loan', 'credit'], grid: 'lg:grid-cols-2' },
  { title: "This month's plan", kinds: ['income', 'expense', 'savings'], grid: 'lg:grid-cols-2 [&>*:first-child]:lg:col-span-2' },
]

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{children}</dd>
    </div>
  )
}

function Tile({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function Overview({ summary: s }: { summary: Summary }) {
  const owned = Number(s.assets) + Number(s.debit.end)
  const owed = Number(s.loans) + Number(s.credit.end)
  return (
    <section aria-label="Overview" className="space-y-3">
      <Card className="grid gap-0 divide-y py-0 lg:grid-cols-[1.3fr_1fr_1fr] lg:divide-x lg:divide-y-0">
        <div role="group" aria-label="Net worth" className="flex flex-col justify-between gap-6 rounded-t-2xl bg-accent/60 p-6 lg:rounded-l-2xl lg:rounded-tr-none">
          <div>
            <h2 className="font-semibold text-accent-foreground">Net worth</h2>
            <p className="text-sm text-muted-foreground">What you own minus what you owe, at month end</p>
          </div>
          <p className="text-5xl font-bold tracking-tight break-all sm:text-6xl">{money(s.net_worth)}</p>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Owned</dt>
              <dd className="font-semibold tabular-nums">{money(owned)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Owed</dt>
              <dd className="font-semibold tabular-nums">{money(owed)}</dd>
            </div>
          </dl>
        </div>
        <Tile title="Monthly remainder" hint="Post-tax income minus expenses and savings">
          <table aria-label="Monthly remainder" className="w-full text-sm tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal">
                  <span className="sr-only">Line</span>
                </th>
                <th className="pb-1 pl-4 text-right font-normal">Budgeted</th>
                <th className="pb-1 pl-4 text-right font-normal">Actual</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['', 'Post-tax income', s.income.post_tax, s.income.post_tax],
                  ['−', 'Expenses', s.expenses.budgeted, s.expenses.actual],
                  ['−', 'Savings', s.savings.budgeted, s.savings.actual],
                ] as const
              ).map(([op, label, budgeted, actual]) => (
                <tr key={label}>
                  <th scope="row" className="py-0.5 text-left font-normal text-muted-foreground">
                    <span className="inline-block w-3" aria-hidden>{op}</span>
                    {label}
                  </th>
                  <td className="pl-4 text-right">{money(budgeted)}</td>
                  <td className="pl-4 text-right">{money(actual)}</td>
                </tr>
              ))}
              <tr className="border-t font-semibold">
                <th scope="row" className="pt-2 text-left">
                  <span className="inline-block w-3" aria-hidden>=</span>
                  Left over
                </th>
                <td className="pt-2 pl-4 text-right">{money(s.remainder.budgeted)}</td>
                <td className="pt-2 pl-4 text-right">{money(s.remainder.actual)}</td>
              </tr>
              <tr>
                <th scope="row" className="pt-2 text-left font-normal text-muted-foreground">
                  Versus plan
                </th>
                <td colSpan={2} className="pt-2 text-right">
                  <Delta value={s.remainder.difference} />
                </td>
              </tr>
            </tbody>
          </table>
        </Tile>
        <Tile title="Monthly income" hint="Everything coming in this month">
          <dl className="space-y-2 text-sm">
            <Figure label="Pre-tax">{money(s.income.pre_tax)}</Figure>
            <Figure label="Post-tax">{money(s.income.post_tax)}</Figure>
            <div className="flex items-baseline justify-between gap-4 border-t pt-2 text-muted-foreground">
              <dt>Taxes and deductions</dt>
              <dd className="tabular-nums">{money(Number(s.income.pre_tax) - Number(s.income.post_tax))}</dd>
            </div>
          </dl>
        </Tile>
      </Card>
      <ul aria-label="Legend" className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-sm text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <CircleCheck className="size-4 text-primary" aria-hidden /> {TONE_LABEL.good}
        </li>
        <li className="flex items-center gap-1.5">
          <CircleAlert className="size-4 text-destructive" aria-hidden /> {TONE_LABEL.bad}
        </li>
        <li>Differences are signed: + is more than planned or than on day 1, − is less</li>
      </ul>
    </section>
  )
}

function Contributions({ data }: { data: SharedData }) {
  return (
    <section aria-label="Contributions">
      <Card className="gap-4">
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-semibold">Who brings what</h2>
            <p className="text-sm text-muted-foreground">Each person's share of the combined numbers above</p>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {data.members.map((m) => {
              const s = data.per_member.find((p) => p.user_id === m.id)!.summary
              return (
                <li key={m.id} className="space-y-3 rounded-xl bg-muted/60 p-4">
                  <div className="flex items-center gap-2 font-semibold">
                    <UserAvatar {...m} className="size-7 text-sm" />
                    {m.username}
                  </div>
                  <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                    <Figure label="Income">{money(s.income.post_tax)}</Figure>
                    <Figure label="Spent">{money(s.expenses.actual)}</Figure>
                    <Figure label="Saved">{money(s.savings.actual)}</Figure>
                    <Figure label="Net worth">{money(s.net_worth)}</Figure>
                  </dl>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}

export function BudgetPage() {
  const [month, setMonth] = useState(currentMonth)
  const [view, setView] = useState('mine')
  const [linked, setLinked] = useState<LinkEntry[]>([])
  const [data, setData] = useState<MonthData | SharedData | null>(null)
  const [copyError, setCopyError] = useState('')
  const path = view === 'mine' ? `/api/budget/${month}` : `/api/budget/${month}/shared/${view}`
  // The path on screen. Responses that land after the user moved to another month or view are dropped.
  const shown = useRef(path)
  const show = (from: string, d: MonthData | SharedData) => shown.current === from && setData(d)

  useEffect(() => void api<{ linked: LinkEntry[] }>('/api/links').then((l) => setLinked(l.linked), () => {}), [])
  useEffect(() => {
    shown.current = path
    setCopyError('')
    api<MonthData | SharedData>(path).then(
      (d) => show(path, d),
      (err) => toast.error(errorText(err)),
    )
  }, [path])

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      show(path, await api<MonthData>(path))
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  async function copyPrevious() {
    try {
      show(path, await api<MonthData>(`/api/budget/${month}/copy-previous`, { method: 'POST' }))
    } catch (err) {
      setCopyError(errorText(err))
    }
  }

  const shared = data && 'members' in data ? data : null
  const owners = shared ? Object.fromEntries(shared.members.map((m) => [m.id, m])) : undefined
  const handlers = (kind: Kind) =>
    shared
      ? {}
      : {
          onAdd: (v: LineInput) => run(() => api(`/api/budget/${month}/lines`, { method: 'POST', json: { kind, ...v } })),
          onUpdate: (id: number, v: LineInput) => run(() => api(`/api/budget/lines/${id}`, { method: 'PATCH', json: v })),
          onDelete: (id: number) => run(() => api(`/api/budget/lines/${id}`, { method: 'DELETE' })),
        }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1>Budget</h1>
            <p className="mt-1 text-muted-foreground">What you own, what you owe and where this month's money goes.</p>
          </div>
          <MonthNav month={month} onChange={setMonth} />
        </div>
        {linked.length > 0 && (
          <Tabs value={view} onValueChange={setView}>
            <TabsList className="h-auto max-w-full flex-wrap justify-start rounded-full p-1">
              <TabsTrigger value="mine" className="rounded-full px-4 py-1.5">
                Mine
              </TabsTrigger>
              {linked.map((l) => (
                <TabsTrigger key={l.user_id} value={String(l.user_id)} className="rounded-full px-4 py-1.5">
                  Shared with {l.username}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      {data && (
        <>
          <Overview summary={data.summary} />
          {shared && <Contributions data={shared} />}
          {!shared && !data.lines.length && (
            <Card className="flex-row flex-wrap items-center justify-between gap-4 border-dashed px-6 shadow-none">
              <div className="space-y-1">
                <h2 className="font-semibold">Nothing planned for {monthLabel(month)} yet</h2>
                <p className="text-sm text-muted-foreground">Add lines below, or bring over last month's and adjust what changed.</p>
                <FormError>{copyError}</FormError>
              </div>
              <Button className="rounded-full" onClick={copyPrevious}>
                <Copy /> Copy last month
              </Button>
            </Card>
          )}
          {SECTIONS.map((section) => (
            <section key={section.title} className="space-y-3">
              <h2 className="px-1 text-xl font-bold tracking-tight">{section.title}</h2>
              <div className={`grid items-start gap-6 ${section.grid}`}>
                {section.kinds.map((kind) => (
                  <BudgetCard
                    key={`${kind}-${view}-${month}`}
                    kind={kind}
                    lines={data.lines.filter((l) => l.kind === kind)}
                    summary={data.summary}
                    owners={owners}
                    {...handlers(kind)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
