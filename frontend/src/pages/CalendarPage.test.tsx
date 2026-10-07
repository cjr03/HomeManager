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
    { id: 1, owner_id: USER.id, title: 'Dentist', date: '2026-03-10', start_time: '09:30:00', notes: '', shared: false, done: false },
    { id: 2, owner_id: 5, title: 'Party', date: '2026-03-14', start_time: null, notes: 'Bring cake', shared: true, done: true },
  ],
  tasks: [
    { id: 11, owner_id: USER.id, title: 'Pay rent', date: '2026-03-10', start_time: '17:00:00', notes: 'Online', shared: false, done: false },
    { id: 12, owner_id: 5, title: 'Book vet', date: '2026-03-11', start_time: null, notes: '', shared: true, done: true },
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
  { id: 3, owner_id: USER.id, title: 'Bins', notes: '', start_date: '2026-03-03', recurrence: 'weekly', weekdays: [], end_date: null, shared: false, assignee: EVE },
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
    expect(await within(tenth).findByText('09:30')).toBeInTheDocument() // the grid renders before the month loads
    expect(within(tenth).getByText('Dentist')).toBeInTheDocument()
    expect(within(tenth).getByText('Bins').closest('li')).toHaveTextContent('Bins, done')
    expect(within(tenth).getByText('Bins').closest('li')!.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,eve')
    expect(within(tenth).getByText('Pay rent').closest('li')).not.toHaveTextContent('done')
    expect(within(tenth).getByText('Pay rent').closest('li')).toHaveTextContent('17:00')
    expect(within(await day('Wednesday, March 11')).getByText('Book vet').closest('li')).toHaveTextContent('Book vet, done')

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

  it('ticks off a task in the day dialog; only my own tasks can be edited', async () => {
    setup({ 'POST /api/tasks/11/done': undefined })
    await userEvent.click(await day('Tuesday, March 10'))
    const dialog = screen.getByRole('dialog', { name: 'Tuesday, March 10' })
    const rent = within(dialog).getByRole('checkbox', { name: 'Pay rent' })
    expect(rent).not.toBeChecked()
    expect(within(dialog).getByText('Online')).toBeInTheDocument()
    expect(rent.closest('li')).toHaveTextContent('17:00')
    await userEvent.click(rent)
    expect(api).toHaveBeenCalledWith('/api/tasks/11/done', { method: 'POST' })
    expect(rent).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Edit Pay rent' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(await day('Wednesday, March 11'))
    const eleventh = screen.getByRole('dialog', { name: 'Wednesday, March 11' })
    expect(within(eleventh).getByRole('checkbox', { name: 'Book vet' })).toBeChecked()
    expect(await within(eleventh).findByText('Shared by eve')).toBeInTheDocument()
    expect(within(eleventh).queryByRole('button', { name: 'Edit Book vet' })).not.toBeInTheDocument()
  })

  it('reverts a task tick that fails to save', async () => {
    setup({
      'POST /api/tasks/11/done': () => {
        throw new ApiError(404, 'Task not found')
      },
    })
    await userEvent.click(await day('Tuesday, March 10'))
    const rent = within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Pay rent' })
    await userEvent.click(rent)
    await vi.waitFor(() => expect(rent).not.toBeChecked())
  })

  it('adds a task from the day dialog', async () => {
    setup({ 'POST /api/tasks': MONTH.tasks[0] })
    await userEvent.click(await day('Thursday, March 12'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('No tasks.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add task' }))
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-03-12')
    await userEvent.type(within(dialog).getByLabelText('Title'), ' Renew passport ')
    await userEvent.type(within(dialog).getByLabelText('Time'), '08:00')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Share with linked accounts' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save task' }))
    expect(api).toHaveBeenCalledWith('/api/tasks', {
      method: 'POST',
      json: { title: 'Renew passport', date: '2026-03-12', start_time: '08:00', notes: '', shared: true },
    })
  })

  it('edits, moves and deletes my task', async () => {
    setup({ 'PUT /api/tasks/11': MONTH.tasks[0], 'DELETE /api/tasks/11': undefined })
    await userEvent.click(await day('Tuesday, March 10'))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit Pay rent' }))
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('Online')
    expect(within(dialog).getByLabelText('Time')).toHaveValue('17:00')
    await userEvent.clear(within(dialog).getByLabelText('Time'))
    await userEvent.clear(within(dialog).getByLabelText('Date'))
    await userEvent.type(within(dialog).getByLabelText('Date'), '2026-03-20')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save task' }))
    expect(api).toHaveBeenCalledWith('/api/tasks/11', {
      method: 'PUT',
      json: { title: 'Pay rent', date: '2026-03-20', start_time: null, notes: 'Online', shared: false },
    })
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Pay rent' }))
    expect(api).toHaveBeenCalledWith('/api/tasks/11', { method: 'DELETE' })
  })

  it('adds an event or a task on any date from the header', async () => {
    setup({ 'POST /api/events': MONTH.events[0], 'POST /api/tasks': MONTH.tasks[0] })
    await userEvent.click(await screen.findByRole('button', { name: 'Add event' }))
    let dialog = screen.getByRole('dialog', { name: 'New event' })
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-03-10') // today
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Flight')
    await userEvent.clear(within(dialog).getByLabelText('Date'))
    await userEvent.type(within(dialog).getByLabelText('Date'), '2026-04-02')
    await userEvent.type(within(dialog).getByLabelText('Time'), '07:15')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save event' }))
    expect(api).toHaveBeenCalledWith('/api/events', {
      method: 'POST',
      json: { title: 'Flight', date: '2026-04-02', start_time: '07:15', notes: '', shared: false },
    })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }))
    dialog = screen.getByRole('dialog', { name: 'New task' })
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-04-01') // first of the month shown
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Pack')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save task' }))
    expect(api).toHaveBeenCalledWith('/api/tasks', {
      method: 'POST',
      json: { title: 'Pack', date: '2026-04-01', start_time: null, notes: '', shared: false },
    })
  })

  it('marks events done from the day dialog and shows done events struck through', async () => {
    setup({
      'POST /api/events/1/done': undefined,
      'DELETE /api/events/2/done': () => {
        throw new ApiError(404, 'Event not found')
      },
    })
    const party = within(await day('Saturday, March 14')).getByText('Party')
    expect(party.closest('li')).toHaveTextContent('Party, done')
    expect(party).toHaveClass('line-through')

    await userEvent.click(await day('Tuesday, March 10'))
    const box = within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Dentist' })
    expect(box).not.toBeChecked()
    await userEvent.click(box)
    expect(api).toHaveBeenCalledWith('/api/events/1/done', { method: 'POST' })
    expect(box).toBeChecked()
    await userEvent.keyboard('{Escape}')
    expect(within(await day('Tuesday, March 10')).getByText('Dentist').closest('li')).toHaveTextContent('Dentist, done')

    await userEvent.click(await day('Saturday, March 14'))
    const partyBox = within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Party' })
    expect(partyBox).toBeChecked()
    await userEvent.click(partyBox)
    expect(api).toHaveBeenCalledWith('/api/events/2/done', { method: 'DELETE' })
    expect(partyBox).toBeChecked() // reverted after the failed save
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
    expect(card.queryByRole('checkbox', { name: 'Tue' })).not.toBeInTheDocument()
    await userEvent.selectOptions(card.getByLabelText('Repeats'), 'Every week')
    expect(card.getByRole('checkbox', { name: 'Tue' })).toBeChecked() // the start's weekday
    await userEvent.click(card.getByRole('checkbox', { name: 'Thu' }))
    await userEvent.type(card.getByLabelText('Ends (optional)'), '2026-06-30')
    await userEvent.click(card.getByLabelText('Share with linked accounts'))
    await userEvent.click(card.getByRole('button', { name: 'Save chore' }))
    expect(api).toHaveBeenCalledWith('/api/chores', {
      method: 'POST',
      json: { title: 'Mop', assignee_id: 5, start_date: '2026-03-10', recurrence: 'weekly', weekdays: [1, 3], end_date: '2026-06-30', notes: '', shared: true },
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
      json: { title: 'Bins', assignee_id: 5, start_date: '2026-03-03', recurrence: 'monthly', weekdays: [], end_date: null, notes: '', shared: false },
    })
    await userEvent.click(card.getByRole('button', { name: 'Delete Bins' }))
    expect(api).toHaveBeenCalledWith('/api/chores/3', { method: 'DELETE' })
  })

  it('describes a chore on several weekdays', async () => {
    setup({ 'GET /api/chores': [{ ...CHORES[0], weekdays: [0, 3] }] })
    expect(await screen.findByText('Every week on Mon, Thu from Mar 3')).toBeInTheDocument()
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
      json: { title: 'Bins', assignee_id: 8, start_date: '2026-03-03', recurrence: 'weekly', weekdays: [], end_date: null, notes: '', shared: false },
    })
  })

  it('marks shared chores: mine as Shared, a linked account\'s by its owner', async () => {
    setup({
      'GET /api/chores': [
        { ...CHORES[0], shared: true },
        { ...CHORES[0], id: 10, owner_id: 5, title: 'Hoover', assignee: EVE, shared: true },
      ],
    })
    const card = within((await screen.findByRole('heading', { name: 'Chores' })).closest('[data-slot="card"]') as HTMLElement)
    const bins = (await card.findByText('Bins')).closest('li') as HTMLElement
    expect(within(bins).getByText('Shared')).toBeInTheDocument()
    expect(await card.findByText('From eve')).toBeInTheDocument()
    expect(card.queryByRole('button', { name: 'Edit Hoover' })).not.toBeInTheDocument()
  })
})
