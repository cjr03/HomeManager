import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { USER, mockApi, renderAt } from '@/test-utils'

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: vi.fn() }))

const EVE = { id: 5, username: 'eve', avatar: null }
const ME = { id: USER.id, username: USER.username, avatar: null }
const occ = (chore_id: number, title: string, date: string, done = false, assignee = EVE) => ({
  chore_id,
  title,
  date,
  assignee_id: assignee.id,
  owner_id: USER.id,
  done,
})
const MONTH = {
  events: [
    { id: 1, owner_id: USER.id, title: 'Dentist', date: '2026-03-10', start_time: '09:30:00', notes: '', shared: false },
    { id: 2, owner_id: 5, title: 'Party', date: '2026-03-14', start_time: null, notes: 'Bring cake', shared: true },
  ],
  chores: [
    occ(3, 'Bins', '2026-03-10', true),
    occ(4, 'Dishes', '2026-03-14', false, ME),
    occ(6, 'Laundry', '2026-03-14'),
    occ(7, 'Plants', '2026-03-14'),
  ],
  people: [{ ...EVE, avatar: 'data:image/png;base64,eve' }, ME],
}
const CHORES = [
  { id: 3, owner_id: USER.id, title: 'Bins', notes: '', start_date: '2026-03-03', recurrence: 'weekly', end_date: null, assignee: EVE },
]
const LINKS = { incoming: [], outgoing: [], linked: [{ id: 9, user_id: 5, username: 'eve', avatar: null }] }

function setup(extra: Record<string, unknown> = {}) {
  mockApi({
    'GET /api/me': USER,
    'GET /api/calendar/2026-03': MONTH,
    'GET /api/chores': CHORES,
    'GET /api/links': LINKS,
    ...extra,
  })
  renderAt('/calendar')
}

const day = (name: string) => screen.findByRole('button', { name })

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12))
  })
  afterEach(() => vi.useRealTimers())

  it('shows events and chores in their day cells, highlights today and collapses overflow', async () => {
    setup()
    const tenth = await day('Tuesday, March 10')
    expect(tenth).toHaveAttribute('aria-current', 'date')
    expect(within(tenth).getByText('09:30')).toBeInTheDocument()
    expect(within(tenth).getByText('Dentist')).toBeInTheDocument()
    expect(within(tenth).getByText('Bins').closest('li')).toHaveTextContent('Bins, done')
    expect(within(tenth).getByText('Bins').closest('li')!.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,eve')

    const fourteenth = await day('Saturday, March 14')
    expect(fourteenth).not.toHaveAttribute('aria-current')
    expect(within(fourteenth).getByText('Party')).toBeInTheDocument()
    expect(within(fourteenth).getByText('Dishes').closest('li')).not.toHaveTextContent('done')
    expect(within(fourteenth).getByText('+2 more')).toBeInTheDocument()
    expect(within(fourteenth).queryByText('Plants')).not.toBeInTheDocument()
  })

  it('opens a day to see everything and toggle a chore', async () => {
    setup({ 'DELETE /api/chores/3/done/2026-03-10': undefined })
    await userEvent.click(await day('Tuesday, March 10'))
    const dialog = screen.getByRole('dialog', { name: 'Tuesday, March 10' })
    const box = within(dialog).getByRole('checkbox', { name: 'Bins' })
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(api).toHaveBeenCalledWith('/api/chores/3/done/2026-03-10', { method: 'DELETE' })
    expect(box).not.toBeChecked()
  })

  it('lists overflowing items in the day dialog', async () => {
    setup()
    await userEvent.click(await day('Saturday, March 14'))
    const dialog = screen.getByRole('dialog', { name: 'Saturday, March 14' })
    expect(within(dialog).getByRole('checkbox', { name: 'Plants' })).toBeInTheDocument()
    expect(within(dialog).getByText('Bring cake')).toBeInTheDocument()
    expect(await within(dialog).findByText('Shared by eve')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Edit Party' })).not.toBeInTheDocument()
  })

  it('adds a shared event from the day dialog', async () => {
    setup({ 'POST /api/events': MONTH.events[0] })
    await userEvent.click(await day('Thursday, March 12'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Nothing planned yet.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add event' }))
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Vet')
    await userEvent.type(within(dialog).getByLabelText('Time'), '14:00')
    await userEvent.type(within(dialog).getByLabelText('Notes'), 'Shots')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Share with linked accounts' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save event' }))
    expect(api).toHaveBeenCalledWith('/api/events', {
      method: 'POST',
      json: { title: 'Vet', date: '2026-03-12', start_time: '14:00', notes: 'Shots', shared: true },
    })
  })

  it('edits and deletes my event', async () => {
    setup({ 'PUT /api/events/1': MONTH.events[0], 'DELETE /api/events/1': undefined })
    await userEvent.click(await day('Tuesday, March 10'))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit Dentist' }))
    const title = within(dialog).getByLabelText('Title')
    expect(title).toHaveValue('Dentist')
    expect(within(dialog).getByLabelText('Time')).toHaveValue('09:30')
    await userEvent.clear(title)
    await userEvent.type(title, 'Orthodontist')
    await userEvent.clear(within(dialog).getByLabelText('Time'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save event' }))
    expect(api).toHaveBeenCalledWith('/api/events/1', {
      method: 'PUT',
      json: { title: 'Orthodontist', date: '2026-03-10', start_time: null, notes: '', shared: false },
    })
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Dentist' }))
    expect(api).toHaveBeenCalledWith('/api/events/1', { method: 'DELETE' })
  })

  it('creates a weekly chore for a linked account', async () => {
    setup({ 'POST /api/chores': CHORES[0] })
    const card = within((await screen.findByRole('heading', { name: 'Chores' })).closest('[data-slot="card"]') as HTMLElement)
    await userEvent.click(card.getByRole('button', { name: 'New chore' }))
    expect(card.getByLabelText('Starts')).toHaveValue('2026-03-10')
    expect(card.getByRole('option', { name: 'You (ann)' })).toBeInTheDocument()
    await card.findByRole('option', { name: 'eve' }) // linked accounts load separately
    await userEvent.type(card.getByLabelText('Title'), 'Mop')
    await userEvent.selectOptions(card.getByLabelText('Assignee'), 'eve')
    await userEvent.selectOptions(card.getByLabelText('Repeats'), 'Every week')
    await userEvent.type(card.getByLabelText('Ends (optional)'), '2026-06-30')
    await userEvent.click(card.getByRole('button', { name: 'Save chore' }))
    expect(api).toHaveBeenCalledWith('/api/chores', {
      method: 'POST',
      json: { title: 'Mop', assignee_id: 5, start_date: '2026-03-10', recurrence: 'weekly', end_date: '2026-06-30', notes: '' },
    })
  })

  it('shows why a chore could not be saved', async () => {
    setup({
      'POST /api/chores': () => {
        throw new ApiError(400, 'Chores can only be assigned to you or a linked account')
      },
    })
    await userEvent.click(await screen.findByRole('button', { name: 'New chore' }))
    await userEvent.type(screen.getByLabelText('Title'), 'Mop')
    await userEvent.click(screen.getByRole('button', { name: 'Save chore' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chores can only be assigned to you or a linked account')
  })

  it('lists, edits and deletes chores', async () => {
    setup({ 'PUT /api/chores/3': CHORES[0], 'DELETE /api/chores/3': undefined })
    const card = within((await screen.findByRole('heading', { name: 'Chores' })).closest('[data-slot="card"]') as HTMLElement)
    expect(await card.findByText('Every week from Mar 3')).toBeInTheDocument()
    await userEvent.click(card.getByRole('button', { name: 'Edit Bins' }))
    expect(card.getByLabelText('Title')).toHaveValue('Bins')
    expect(card.getByLabelText('Assignee')).toHaveValue('5')
    await userEvent.selectOptions(card.getByLabelText('Repeats'), 'Every month')
    await userEvent.click(card.getByRole('button', { name: 'Save chore' }))
    expect(api).toHaveBeenCalledWith('/api/chores/3', {
      method: 'PUT',
      json: { title: 'Bins', assignee_id: 5, start_date: '2026-03-03', recurrence: 'monthly', end_date: null, notes: '' },
    })
    await userEvent.click(card.getByRole('button', { name: 'Delete Bins' }))
    expect(api).toHaveBeenCalledWith('/api/chores/3', { method: 'DELETE' })
  })

  it('keeps a since-unlinked assignee when editing a chore', async () => {
    const zed = { id: 8, username: 'zed', avatar: null }
    setup({ 'GET /api/chores': [{ ...CHORES[0], assignee: zed }], 'PUT /api/chores/3': CHORES[0] })
    const card = within((await screen.findByRole('heading', { name: 'Chores' })).closest('[data-slot="card"]') as HTMLElement)
    await userEvent.click(await card.findByRole('button', { name: 'Edit Bins' }))
    await card.findByRole('option', { name: 'eve' }) // links loaded, zed isn't among them
    expect(card.getByLabelText('Assignee')).toHaveValue('8')
    await userEvent.click(card.getByRole('button', { name: 'Save chore' }))
    expect(api).toHaveBeenCalledWith('/api/chores/3', {
      method: 'PUT',
      json: { title: 'Bins', assignee_id: 8, start_date: '2026-03-03', recurrence: 'weekly', end_date: null, notes: '' },
    })
  })
})
