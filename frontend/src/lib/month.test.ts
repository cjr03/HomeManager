import { describe, expect, it } from 'vitest'
import { addDays, currentMonth, formatDay, monthGrid, monthLabel, shiftMonth, today, weekStart } from './month'

describe('monthGrid', () => {
  it('pads a month that starts mid-week with leading and trailing nulls', () => {
    // October 2026 starts on a Thursday and has 31 days.
    const weeks = monthGrid('2026-10')
    expect(weeks).toHaveLength(5)
    expect(weeks[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03'])
    expect(weeks[4]).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
  })

  it('every week has seven slots and days appear once in order', () => {
    for (const m of ['2026-01', '2026-02', '2024-02', '2026-08', '2027-05']) {
      const weeks = monthGrid(m)
      weeks.forEach((w) => expect(w).toHaveLength(7))
      const days = weeks.flat().filter((d): d is string => d !== null)
      expect(days[0]).toBe(`${m}-01`)
      expect(days).toEqual([...days].sort())
      expect(new Set(days).size).toBe(days.length)
    }
  })

  it('handles a month starting on Sunday with no leading padding', () => {
    // February 2026 starts on Sunday and has 28 days: exactly four full weeks.
    const weeks = monthGrid('2026-02')
    expect(weeks).toHaveLength(4)
    expect(weeks[0][0]).toBe('2026-02-01')
    expect(weeks[3][6]).toBe('2026-02-28')
  })

  it('includes Feb 29 in a leap year', () => {
    const days = monthGrid('2024-02').flat().filter(Boolean)
    expect(days).toHaveLength(29)
    expect(days.at(-1)).toBe('2024-02-29')
  })

  it('handles a month starting on Saturday that needs six weeks', () => {
    // August 2026 starts on Saturday and has 31 days.
    const weeks = monthGrid('2026-08')
    expect(weeks).toHaveLength(6)
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-08-01'])
    expect(weeks[5]).toEqual(['2026-08-30', '2026-08-31', null, null, null, null, null])
  })
})

describe('shiftMonth', () => {
  it('moves forward and back within a year', () => {
    expect(shiftMonth('2026-05', 1)).toBe('2026-06')
    expect(shiftMonth('2026-05', -1)).toBe('2026-04')
    expect(shiftMonth('2026-05', 0)).toBe('2026-05')
  })

  it('rolls over year boundaries in both directions', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-03', -15)).toBe('2024-12')
    expect(shiftMonth('2026-03', 24)).toBe('2028-03')
  })
})

describe('currentMonth', () => {
  it('formats the given date as YYYY-MM in local time', () => {
    expect(currentMonth(new Date(2026, 0, 31))).toBe('2026-01')
    expect(currentMonth(new Date(2026, 11, 1))).toBe('2026-12')
  })

  it('defaults to today', () => {
    expect(currentMonth()).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('monthLabel', () => {
  it('renders a human month name and year', () => {
    expect(monthLabel('2026-10')).toBe('October 2026')
    expect(monthLabel('2027-01')).toBe('January 2027')
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDays('2026-10-04', 6)).toBe('2026-10-10')
  })
})

describe('weekStart', () => {
  it('returns the Sunday on or before the day', () => {
    expect(weekStart('2026-10-04')).toBe('2026-10-04')
    expect(weekStart('2026-10-10')).toBe('2026-10-04')
    expect(weekStart('2026-10-01')).toBe('2026-09-27')
  })
})

describe('today', () => {
  it('formats the given date as YYYY-MM-DD in local time', () => {
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(today(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
    expect(today(new Date(2026, 9, 6, 23, 30))).toBe('2026-10-06')
  })
})

describe('formatDay', () => {
  it('formats an ISO day without timezone drift', () => {
    expect(formatDay('2026-03-10', { weekday: 'long', month: 'long', day: 'numeric' })).toBe('Tuesday, March 10')
    expect(formatDay('2026-01-01', { month: 'short', day: 'numeric' })).toBe('Jan 1')
  })
})
