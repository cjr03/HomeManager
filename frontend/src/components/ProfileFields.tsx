import { Minus, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Preferences } from '@/lib/auth'
import { cn } from '@/lib/utils'

export const DEFAULT_PREFERENCES: Preferences = {
  diet: 'none',
  allergies: [],
  dislikes: '',
  favorite_cuisines: [],
  cooking_time: 'moderate',
  budget_level: 'moderate',
}

export const DIETS = [
  ['none', 'No restrictions'],
  ['vegetarian', 'Vegetarian'],
  ['vegan', 'Vegan'],
  ['pescatarian', 'Pescatarian'],
  ['keto', 'Keto'],
  ['paleo', 'Paleo'],
  ['gluten_free', 'Gluten-free'],
]
const ALLERGIES = ['peanuts', 'tree nuts', 'dairy', 'eggs', 'shellfish', 'fish', 'soy', 'wheat', 'sesame']
const CUISINES = ['Italian', 'Mexican', 'Chinese', 'Japanese', 'Indian', 'Thai', 'Mediterranean', 'Middle Eastern', 'Korean', 'American', 'French']
const COOKING_TIMES = [
  ['quick', 'Quick'],
  ['moderate', 'Moderate'],
  ['elaborate', 'Elaborate'],
]
const BUDGETS = [
  ['thrifty', 'Thrifty'],
  ['moderate', 'Moderate'],
  ['generous', 'Generous'],
]

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-sm transition-all outline-none hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95',
        pressed ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function ChipGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function PreferencesFields({ value, onChange }: { value: Preferences; onChange: (p: Preferences) => void }) {
  const set = (patch: Partial<Preferences>) => onChange({ ...value, ...patch })
  const single = (legend: string, key: 'diet' | 'cooking_time' | 'budget_level', options: string[][]) => (
    <ChipGroup legend={legend}>
      {options.map(([v, label]) => (
        <Chip key={v} pressed={value[key] === v} onClick={() => set({ [key]: v })}>
          {label}
        </Chip>
      ))}
    </ChipGroup>
  )
  const multi = (legend: string, key: 'allergies' | 'favorite_cuisines', options: string[]) => (
    <ChipGroup legend={legend}>
      {options.map((v) => (
        <Chip key={v} pressed={value[key].includes(v)} onClick={() => set({ [key]: toggle(value[key], v) })}>
          {v[0].toUpperCase() + v.slice(1)}
        </Chip>
      ))}
    </ChipGroup>
  )
  return (
    <div className="space-y-5">
      {single('Diet', 'diet', DIETS)}
      {multi('Allergies', 'allergies', ALLERGIES)}
      {multi('Favourite cuisines', 'favorite_cuisines', CUISINES)}
      {single('Cooking time', 'cooking_time', COOKING_TIMES)}
      {single('Grocery budget', 'budget_level', BUDGETS)}
      <div className="space-y-2">
        <Label htmlFor="dislikes">Dislikes</Label>
        <Textarea
          id="dislikes"
          placeholder="Anything you'd rather skip? e.g. olives, cilantro"
          value={value.dislikes}
          onChange={(e) => set({ dislikes: e.target.value })}
        />
      </div>
    </div>
  )
}

export function HouseholdInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.min(20, Math.max(1, n || 1))
  return (
    <div className="space-y-2">
      <Label htmlFor="household">People in your household</Label>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" className="rounded-full" aria-label="Fewer people" onClick={() => onChange(clamp(value - 1))}>
          <Minus />
        </Button>
        <Input
          id="household"
          type="number"
          min={1}
          max={20}
          className="w-20 text-center text-lg font-semibold tabular-nums"
          value={value}
          onChange={(e) => onChange(clamp(e.target.valueAsNumber))}
        />
        <Button type="button" variant="outline" size="icon" className="rounded-full" aria-label="More people" onClick={() => onChange(clamp(value + 1))}>
          <Plus />
        </Button>
      </div>
    </div>
  )
}
