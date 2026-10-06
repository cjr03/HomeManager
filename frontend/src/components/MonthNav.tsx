import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { currentMonth, monthLabel, shiftMonth } from '@/lib/month'

export function MonthNav({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft />
      </Button>
      <h2 className="min-w-40 text-center text-lg font-semibold tabular-nums">{monthLabel(month)}</h2>
      <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRight />
      </Button>
      <Button variant="outline" size="sm" className="ml-2 rounded-full" onClick={() => onChange(currentMonth())}>
        Today
      </Button>
    </div>
  )
}
