import { useState } from 'react'
import { MonthNav } from '@/components/MonthNav'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { currentMonth } from '@/lib/month'

export function BudgetPage() {
  const [month, setMonth] = useState(currentMonth)
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-4">
        <h1>Budget</h1>
        <MonthNav month={month} onChange={setMonth} />
      </CardHeader>
      <CardContent className="text-muted-foreground">
        Track income, spending, savings and what's left over this month.
      </CardContent>
    </Card>
  )
}
