import { useState } from 'react'
import { MonthNav } from '@/components/MonthNav'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { currentMonth } from '@/lib/month'

export function MealsPage() {
  const [month, setMonth] = useState(currentMonth)
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-4">
        <h1>Meals</h1>
        <MonthNav month={month} onChange={setMonth} />
      </CardHeader>
      <CardContent className="text-muted-foreground">
        Plan breakfast, lunch, dinner and snacks for each day, then turn them into a shopping list.
      </CardContent>
    </Card>
  )
}
