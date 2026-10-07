import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import type { Item } from '@/components/DayDialog'
import { errorText } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

type Row = { name: string; quantity: string; unit: string }

const toRows = ({ items }: { items: Item[] }) => items.map((i) => ({ ...i, quantity: String(i.quantity) }))

/** `lastWeek` is the Sunday starting the week whose shopping and meals "Generate pantry" settles.
 * A new `version` refetches; rows are replaced only if the saved pantry changed, so unsaved edits survive. */
export function PantryCard({ lastWeek, version }: { lastWeek: string; version: number }) {
  const [rows, setRows] = useState<Row[] | null>(null) // null until loaded, so a late load can't wipe edits
  const [generating, setGenerating] = useState(false)
  const [generatedFor, setGeneratedFor] = useState<string | null>(null) // once per week: a repeat would subtract it twice
  const saved = useRef('') // the server's pantry as last shown
  const show = (p: { items: Item[] }) => {
    saved.current = JSON.stringify(p.items)
    setRows(toRows(p))
  }

  useEffect(() => {
    api<{ items: Item[] }>('/api/pantry').then(
      (p) => JSON.stringify(p.items) !== saved.current && show(p),
      (err) => toast.error(errorText(err)),
    )
  }, [version])

  if (!rows) return null

  const set = (n: number, patch: Partial<Row>) => setRows(rows.map((r, i) => (i === n ? { ...r, ...patch } : r)))

  // Both buttons submit, so Generate saves unsaved edits first and the server works from what you see.
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const generate = (e.nativeEvent as SubmitEvent).submitter?.id === 'generate-pantry'
    const items = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), quantity: Number(r.quantity), unit: r.unit.trim() }))
    setGenerating(generate)
    try {
      show(await api<{ items: Item[] }>('/api/pantry', { method: 'PUT', json: { items } }))
      if (generate) {
        show(await api<{ items: Item[] }>('/api/pantry/generate', { method: 'POST', json: { week_start: lastWeek } }))
        setGeneratedFor(lastWeek)
      }
      toast.success(generate ? 'Pantry generated from last week' : 'Pantry saved')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card role="region" aria-labelledby="pantry-title" className="gap-4">
      <CardHeader>
        <h2 id="pantry-title" className="text-lg font-semibold">
          Pantry
        </h2>
        <CardDescription>What you have left from last week. Meal ideas use these first.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save}>
          {/* Disabled while generating, so a slow agent can't overwrite what you type meanwhile. */}
          <fieldset disabled={generating} className="space-y-3">
            {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing in the pantry yet.</p>}
            <ul className="space-y-2">
              {rows.map((r, i) => {
                const who = r.name.trim() || `item ${i + 1}`
                return (
                  <li key={i} className="grid grid-cols-[minmax(0,1fr)_4rem_3rem_auto] gap-1.5">
                    <Input aria-label={`Item ${i + 1} name`} placeholder="Rice" maxLength={200} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                    <Input
                      aria-label={`Quantity of ${who}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      placeholder="1"
                      required={!!r.name.trim()}
                      value={r.quantity}
                      onChange={(e) => set(i, { quantity: e.target.value })}
                    />
                    <Input aria-label={`Unit of ${who}`} placeholder="kg" maxLength={20} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove item ${i + 1}`}
                      onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setRows([...rows, { name: '', quantity: '', unit: '' }])}>
                <Plus /> Add item
              </Button>
              <Button type="submit" size="sm" className="rounded-full">
                Save pantry
              </Button>
              <Button id="generate-pantry" type="submit" variant="outline" size="sm" className="rounded-full" disabled={generatedFor === lastWeek} aria-busy={generating}>
                {generating ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate pantry
              </Button>
            </div>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}
