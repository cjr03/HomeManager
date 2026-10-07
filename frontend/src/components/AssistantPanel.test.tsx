import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { USER, mockApi, renderAt } from '@/test-utils'

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: vi.fn() }))

const EMPTY_MONTH = { events: [], tasks: [], chores: [], people: [] }
const calls = (path: string) => vi.mocked(api).mock.calls.filter(([p, init]) => p === path && !init?.method).length

function setup(assistant: (init: { json: unknown }) => unknown, path = '/calendar', extra = {}) {
  mockApi({
    'GET /api/me': USER,
    'GET /api/calendar/2026-03': EMPTY_MONTH,
    'GET /api/chores': [],
    'GET /api/links': { incoming: [], outgoing: [], linked: [] },
    'POST /api/assistant': assistant,
    ...extra,
  })
  renderAt(path)
}

const box = () => screen.findByRole('textbox', { name: 'Message Mikayla' })

describe('AssistantPanel', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12))
  })
  afterEach(() => vi.useRealTimers())

  it('sends the page, its context, today and the whole conversation, and shows replies', async () => {
    const sent: unknown[] = []
    const replies = ['Nothing is planned.', 'Sure.']
    setup(({ json }) => {
      sent.push(structuredClone(json))
      return { reply: replies[sent.length - 1], changed: false }
    })
    const panel = await screen.findByRole('complementary', { name: 'Mikayla' })
    await userEvent.type(await box(), 'What is on?{Enter}')
    expect(await within(panel).findByText('Nothing is planned.')).toBeInTheDocument()
    expect(within(panel).getByText('What is on?')).toBeInTheDocument()
    expect(await box()).toHaveValue('')

    await userEvent.type(await box(), 'Line one{Shift>}{Enter}{/Shift}two{Enter}')
    expect(await within(panel).findByText('Sure.')).toBeInTheDocument()
    expect(sent).toEqual([
      { page: 'calendar', today: '2026-03-10', context: { month: '2026-03' }, messages: [{ role: 'user', content: 'What is on?' }] },
      {
        page: 'calendar',
        today: '2026-03-10',
        context: { month: '2026-03' },
        messages: [
          { role: 'user', content: 'What is on?' },
          { role: 'assistant', content: 'Nothing is planned.' },
          { role: 'user', content: 'Line one\ntwo' },
        ],
      },
    ])
  })

  it('shows an error inline and gives the message back to retry', async () => {
    setup(() => {
      throw new ApiError(502, 'Mikayla is unavailable right now')
    })
    await userEvent.type(await box(), 'Hello{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Mikayla is unavailable right now')
    expect(await box()).toHaveValue('Hello')
  })

  it('reloads the page and the signed-in user when the assistant changed something', async () => {
    setup(() => ({ reply: 'Marked it done.', changed: true }))
    await screen.findByRole('button', { name: 'Tuesday, March 10' })
    await waitFor(() => expect(calls('/api/calendar/2026-03')).toBe(1))
    const me = calls('/api/me')
    await userEvent.type(await box(), 'Mark bins done{Enter}')
    expect(await screen.findByText('Marked it done.')).toBeInTheDocument()
    await waitFor(() => expect(calls('/api/calendar/2026-03')).toBe(2))
    expect(calls('/api/me')).toBe(me + 1)
  })

  it('keeps a separate conversation per page', async () => {
    setup(() => ({ reply: 'Hi from calendar.', changed: false }))
    await userEvent.type(await box(), 'Hi{Enter}')
    expect(await screen.findByText('Hi from calendar.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Account' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument()
    expect(screen.queryByText('Hi from calendar.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Calendar' }))
    expect(await screen.findByText('Hi from calendar.')).toBeInTheDocument()
  })

  it('reloads the page showing when the reply lands, not the one it was sent from', async () => {
    let reply!: (r: unknown) => void
    setup(() => new Promise((r) => (reply = r)), '/calendar', { 'GET /api/chores/today?date=2026-03-10': [] })
    await userEvent.type(await box(), 'Mark bins done{Enter}')
    await userEvent.click(screen.getByRole('link', { name: 'Account' }))
    await screen.findByRole('heading', { level: 1, name: 'Account' })
    await waitFor(() => expect(calls('/api/chores/today?date=2026-03-10')).toBe(1))
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()
    await userEvent.type(await box(), 'Next')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    reply({ reply: 'Done.', changed: true })
    await waitFor(() => expect(calls('/api/chores/today?date=2026-03-10')).toBe(2))
  })

  it('keeps a newer draft when an earlier message fails', async () => {
    let fail!: (e: unknown) => void
    setup(() => new Promise((_, r) => (fail = r)))
    await userEvent.type(await box(), 'First{Enter}')
    await userEvent.type(await box(), 'Second')
    fail(new ApiError(502, 'Mikayla is unavailable right now'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await box()).toHaveValue('Second')
  })

  it('moves focus into the sheet when opened, and Escape closes it and returns focus', async () => {
    setup(() => ({ reply: 'ok', changed: false }))
    const trigger = await screen.findByRole('button', { name: 'Open Mikayla' })
    await userEvent.click(trigger)
    expect(await box()).toHaveFocus()
    await userEvent.click(document.body)
    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })
})
