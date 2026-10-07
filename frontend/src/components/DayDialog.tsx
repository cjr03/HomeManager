import { Apple, Coffee, Salad, UtensilsCrossed, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { errorText } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

export type Item = { name: string; quantity: number; unit: string }
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type Meal = {
  date: string
  slot: Slot
  name: string
  servings: number | null
  ingredients: Item[] | null
  instructions: string[] | null
}

// Class names are spelled out so Tailwind sees them.
export const SLOTS = [
  { slot: 'breakfast', label: 'Breakfast', icon: Coffee, text: 'text-slot-breakfast', bg: 'bg-slot-breakfast' },
  { slot: 'lunch', label: 'Lunch', icon: Salad, text: 'text-slot-lunch', bg: 'bg-slot-lunch' },
  { slot: 'dinner', label: 'Dinner', icon: UtensilsCrossed, text: 'text-slot-dinner', bg: 'bg-slot-dinner' },
  { slot: 'snack', label: 'Snack', icon: Apple, text: 'text-slot-snack', bg: 'bg-slot-snack' },
] as const

export const fmtItem = (i: Item) => `${+i.quantity.toFixed(2)}${i.unit ? ` ${i.unit}` : ''} ${i.name}`

export const longDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

function Recipe({ label, meal }: { label: string; meal: Meal }) {
  return (
    <details className="group rounded-xl bg-muted/60 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-muted-foreground select-none hover:text-foreground">
        {label} recipe
      </summary>
      <div className="mt-2 space-y-3">
        {meal.servings && <p className="text-muted-foreground">Serves {meal.servings}</p>}
        {meal.ingredients && (
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {meal.ingredients.map((i) => (
              <li key={i.name}>{fmtItem(i)}</li>
            ))}
          </ul>
        )}
        {meal.instructions && (
          <ol className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
            {meal.instructions.map((step, n) => (
              <li key={n}>{step}</li>
            ))}
          </ol>
        )}
      </div>
    </details>
  )
}

export function DayDialog({
  day,
  meals,
  onClose,
  onChanged,
}: {
  day: string
  meals: Partial<Record<Slot, Meal>>
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [names, setNames] = useState(() => Object.fromEntries(SLOTS.map(({ slot }) => [slot, meals[slot]?.name ?? ''])))

  async function save(e: FormEvent) {
    e.preventDefault()
    const changed = SLOTS.filter(({ slot }) => names[slot].trim() !== (meals[slot]?.name ?? ''))
    try {
      await Promise.all(
        changed.map(({ slot }) => {
          const name = names[slot].trim()
          return api(`/api/meals/${day}/${slot}`, name ? { method: 'PUT', json: { name } } : { method: 'DELETE' })
        }),
      )
      await onChanged()
      onClose()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  async function clear(slot: Slot) {
    setNames((n) => ({ ...n, [slot]: '' }))
    if (!meals[slot]) return
    try {
      await api(`/api/meals/${day}/${slot}`, { method: 'DELETE' })
      await onChanged()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{longDate(day)}</DialogTitle>
          <DialogDescription>Name each meal, or clear the ones you don't need.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {SLOTS.map(({ slot, label, icon: Icon, text }) => {
            const meal = meals[slot]
            return (
              <div key={slot} className="space-y-2">
                <Label htmlFor={`meal-${slot}`} className="gap-1.5">
                  <Icon className={`size-4 ${text}`} aria-hidden />
                  {label}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id={`meal-${slot}`}
                    value={names[slot]}
                    maxLength={200}
                    placeholder={`Add ${label.toLowerCase()}`}
                    onChange={(e) => setNames({ ...names, [slot]: e.target.value })}
                  />
                  {(names[slot] || meal) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Clear ${slot}`}
                      title={`Clear ${slot}`}
                      onClick={() => clear(slot)}
                    >
                      <X />
                    </Button>
                  )}
                </div>
                {meal && (meal.ingredients || meal.instructions) && <Recipe label={label} meal={meal} />}
              </div>
            )
          })}
          <DialogFooter>
            <Button type="button" variant="ghost" className="rounded-full" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="rounded-full">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
