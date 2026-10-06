// Months are "YYYY-MM"; days are ISO "YYYY-MM-DD". Date math uses UTC so local timezones can't shift days.

const pad = (n: number) => String(n).padStart(2, '0')

function parse(month: string) {
  const [y, m] = month.split('-').map(Number)
  return { y, m }
}

/** Sunday-first weeks of ISO dates, padded with null outside the month. */
export function monthGrid(month: string): (string | null)[][] {
  const { y, m } = parse(month)
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= days; d++) cells.push(`${month}-${pad(d)}`)
  while (cells.length % 7) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export function shiftMonth(month: string, delta: number): string {
  const { y, m } = parse(month)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

export function monthLabel(month: string): string {
  const { y, m } = parse(month)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
