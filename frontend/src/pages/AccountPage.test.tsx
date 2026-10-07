import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { USER, mockApi, renderAt } from '@/test-utils'

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: vi.fn() }))

const LINKS = {
  incoming: [{ id: 7, user_id: 3, username: 'cat', avatar: null }],
  outgoing: [{ id: 8, user_id: 4, username: 'dan', avatar: null }],
  linked: [{ id: 9, user_id: 5, username: 'eve', avatar: null }],
}

function setup(extra: Record<string, unknown> = {}) {
  mockApi({ 'GET /api/me': USER, 'GET /api/links': LINKS, ...extra })
  renderAt('/account')
}

async function openPasswordForm() {
  await userEvent.click(await screen.findByRole('button', { name: 'Change password' }))
}

async function fillPassword(current: string, next: string, confirm: string) {
  await userEvent.type(screen.getByLabelText('Current password'), current)
  await userEvent.type(screen.getByLabelText('New password'), next)
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm)
  await userEvent.click(screen.getByRole('button', { name: 'Update password' }))
}

describe('AccountPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
  })

  it('shows the profile with a masked password', async () => {
    setup()
    expect(await screen.findByText('ann@example.com')).toBeInTheDocument()
    expect(screen.getByText('••••••••')).toBeInTheDocument()
    expect(screen.getByLabelText('People in your household')).toHaveValue(2)
  })

  it('rejects mismatched new passwords without calling the API', async () => {
    setup()
    await openPasswordForm()
    await fillPassword('old-password', 'new-password', 'new-passwork')
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalledWith('/api/me/password', expect.anything())
  })

  it('rejects a short new password', async () => {
    setup()
    await openPasswordForm()
    await fillPassword('old-password', 'short', 'short')
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalledWith('/api/me/password', expect.anything())
  })

  it('shows the server error for a wrong current password', async () => {
    setup({
      'PUT /api/me/password': () => {
        throw new ApiError(400, 'Current password is incorrect')
      },
    })
    await openPasswordForm()
    await fillPassword('bad-password', 'new-password', 'new-password')
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect')
  })

  it('changes the password and closes the form', async () => {
    setup({ 'PUT /api/me/password': undefined })
    await openPasswordForm()
    await fillPassword('old-password', 'new-password', 'new-password')
    expect(api).toHaveBeenCalledWith('/api/me/password', {
      method: 'PUT',
      json: { current_password: 'old-password', new_password: 'new-password', new_password_confirm: 'new-password' },
    })
    expect(await screen.findByRole('button', { name: 'Change password' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  })

  it('saves household and preferences', async () => {
    setup({ 'PUT /api/me/profile': USER })
    await userEvent.click(await screen.findByRole('button', { name: 'More people' }))
    await userEvent.click(screen.getByRole('button', { name: 'Vegan' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
    expect(api).toHaveBeenCalledWith('/api/me/profile', {
      method: 'PUT',
      json: { household_size: 3, preferences: { ...USER.preferences, diet: 'vegan' } },
    })
  })

  it('lists links and sends, accepts, cancels and unlinks', async () => {
    setup({
      'POST /api/links': LINKS.outgoing[0],
      'POST /api/links/7/accept': LINKS.incoming[0],
      'DELETE /api/links/8': undefined,
      'DELETE /api/links/9': undefined,
    })
    const card = (await screen.findByRole('heading', { name: 'Linked accounts' })).closest('[data-slot="card"]')!
    const c = within(card as HTMLElement)
    expect(await c.findByText('cat')).toBeInTheDocument()
    expect(c.getByText('dan')).toBeInTheDocument()
    expect(c.getByText('eve')).toBeInTheDocument()

    await userEvent.type(c.getByLabelText('Username to link'), 'dan')
    await userEvent.click(c.getByRole('button', { name: 'Send request' }))
    expect(api).toHaveBeenCalledWith('/api/links', { method: 'POST', json: { username: 'dan' } })

    await userEvent.click(c.getByRole('button', { name: 'Accept cat' }))
    expect(api).toHaveBeenCalledWith('/api/links/7/accept', { method: 'POST' })
    await userEvent.click(c.getByRole('button', { name: 'Cancel request to dan' }))
    expect(api).toHaveBeenCalledWith('/api/links/8', { method: 'DELETE' })
    await userEvent.click(c.getByRole('button', { name: 'Unlink eve' }))
    expect(api).toHaveBeenCalledWith('/api/links/9', { method: 'DELETE' })
  })
  it('declines an incoming link request', async () => {
    setup({ 'DELETE /api/links/7': undefined })
    await userEvent.click(await screen.findByRole('button', { name: 'Decline cat' }))
    expect(api).toHaveBeenCalledWith('/api/links/7', { method: 'DELETE' })
  })

  describe('avatar', () => {
    const png = (bytes: number) => new File([new Uint8Array(bytes)], 'me.png', { type: 'image/png' })

    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:preview')
      URL.revokeObjectURL = vi.fn()
    })

    it('rejects images over 1 MB without uploading', async () => {
      setup()
      await userEvent.upload(await screen.findByLabelText('Upload photo'), png(1024 * 1024 + 1))
      expect(screen.queryByRole('button', { name: 'Save photo' })).not.toBeInTheDocument()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(api).not.toHaveBeenCalledWith('/api/me/avatar', expect.anything())
    })

    it('previews, then uploads the photo as multipart form data', async () => {
      setup({ 'POST /api/me/avatar': undefined })
      const file = png(10)
      await userEvent.upload(await screen.findByLabelText('Upload photo'), file)
      await userEvent.click(screen.getByRole('button', { name: 'Save photo' }))
      expect(api).toHaveBeenCalledWith('/api/me/avatar', { method: 'POST', body: expect.any(FormData) })
      const call = vi.mocked(api).mock.calls.find(([path]) => path === '/api/me/avatar')!
      expect((call[1]!.body as FormData).get('file')).toBe(file)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    })

    it('cancels a preview without uploading', async () => {
      setup()
      await userEvent.upload(await screen.findByLabelText('Upload photo'), png(10))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
      expect(screen.getByLabelText('Upload photo')).toBeInTheDocument()
      expect(api).not.toHaveBeenCalledWith('/api/me/avatar', expect.anything())
    })

    it('removes the current photo', async () => {
      mockApi({ 'GET /api/me': { ...USER, avatar: 'data:image/png;base64,AA==' }, 'GET /api/links': LINKS, 'DELETE /api/me/avatar': undefined })
      renderAt('/account')
      await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
      expect(api).toHaveBeenCalledWith('/api/me/avatar', { method: 'DELETE' })
    })
  })

  describe("today's chores", () => {
    const TODAY = '/api/chores/today?date=2026-03-10'
    const bins = { chore_id: 3, title: 'Bins', date: '2026-03-10', assignee_id: 1, owner_id: 5, done: false }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 2, 10, 23, 30))
    })
    afterEach(() => vi.useRealTimers())

    it('lists my chores for the local date and marks one done', async () => {
      setup({ [`GET ${TODAY}`]: [bins], 'POST /api/chores/3/done/2026-03-10': undefined })
      const box = await screen.findByRole('checkbox', { name: 'Bins' })
      expect(box).not.toBeChecked()
      await userEvent.click(box)
      expect(api).toHaveBeenCalledWith('/api/chores/3/done/2026-03-10', { method: 'POST' })
      expect(box).toBeChecked()
    })

    it('says when nothing is due', async () => {
      setup({ [`GET ${TODAY}`]: [] })
      expect(await screen.findByText('Nothing due today.')).toBeInTheDocument()
    })

    it('keeps the box unchanged when the update fails', async () => {
      setup({
        [`GET ${TODAY}`]: [bins],
        'POST /api/chores/3/done/2026-03-10': () => {
          throw new ApiError(400, "The chore isn't due on that date")
        },
      })
      const box = await screen.findByRole('checkbox', { name: 'Bins' })
      await userEvent.click(box)
      expect(box).not.toBeChecked()
    })
  })
})
