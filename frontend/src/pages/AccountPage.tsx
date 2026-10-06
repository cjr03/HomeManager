import { Check, ImageUp, Trash2, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Field, FormError } from '@/components/Field'
import { HouseholdInput, PreferencesFields } from '@/components/ProfileFields'
import { UserAvatar } from '@/components/UserAvatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { useAuth, useUser } from '@/lib/auth'

const MAX_AVATAR_BYTES = 1024 * 1024
const errorText = (err: unknown) => (err instanceof ApiError ? err.detail : 'Something went wrong, try again')

function SectionTitle({ children, description }: { children: ReactNode; description: string }) {
  return (
    <CardHeader>
      <h2 className="text-lg font-semibold">{children}</h2>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  )
}

function AvatarEditor() {
  const user = useUser()
  const { refresh } = useAuth()
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_AVATAR_BYTES) return void toast.error('Pick an image of 1 MB or less')
    setPreview({ file, url: URL.createObjectURL(file) })
  }

  function clearPreview() {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action()
      await refresh()
      clearPreview()
      toast.success(message)
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  function save() {
    const body = new FormData()
    body.append('file', preview!.file)
    return run(() => api('/api/me/avatar', { method: 'POST', body }), 'Profile picture updated')
  }

  return (
    <div className="flex items-center gap-4">
      <UserAvatar
        username={user.username}
        avatar={preview?.url ?? user.avatar}
        className="size-20 text-3xl ring-4 ring-accent"
      />
      <div className="flex flex-wrap gap-2">
        {preview ? (
          <>
            <Button size="sm" className="rounded-full" onClick={save}>
              <Check /> Save photo
            </Button>
            <Button size="sm" variant="ghost" className="rounded-full" onClick={clearPreview}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" className="cursor-pointer rounded-full has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50" asChild>
              <label>
                <ImageUp /> {user.avatar ? 'Change photo' : 'Upload photo'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={choose} />
              </label>
            </Button>
            {user.avatar && (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-destructive"
                onClick={() => run(() => api('/api/me/avatar', { method: 'DELETE' }), 'Profile picture removed')}
              >
                <Trash2 /> Remove
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', new_password_confirm: '' })
  const [errors, setErrors] = useState<{ new_password?: string; new_password_confirm?: string }>({})
  const [error, setError] = useState('')
  const field = (key: keyof typeof form) => ({
    type: 'password',
    value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs =
      form.new_password.length < 8
        ? { new_password: 'Use at least 8 characters' }
        : form.new_password !== form.new_password_confirm
          ? { new_password_confirm: 'Passwords do not match' }
          : {}
    setErrors(errs)
    setError('')
    if (Object.keys(errs).length) return
    try {
      await api('/api/me/password', { method: 'PUT', json: form })
      toast.success('Password changed')
      onDone()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <form onSubmit={submit} className="animate-in space-y-3 rounded-xl bg-muted/60 p-4 fade-in slide-in-from-top-2" noValidate>
      <Field id="current_password" label="Current password" autoComplete="current-password" {...field('current_password')} />
      <Field id="new_password" label="New password" autoComplete="new-password" error={errors.new_password} {...field('new_password')} />
      <Field
        id="new_password_confirm"
        label="Confirm new password"
        autoComplete="new-password"
        error={errors.new_password_confirm}
        {...field('new_password_confirm')}
      />
      <FormError>{error}</FormError>
      <div className="flex gap-2">
        <Button type="submit" className="rounded-full">
          Update password
        </Button>
        <Button type="button" variant="ghost" className="rounded-full" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ProfileCard() {
  const user = useUser()
  const [changing, setChanging] = useState(false)
  return (
    <Card>
      <SectionTitle description="How you appear to linked accounts.">Profile</SectionTitle>
      <CardContent className="space-y-6">
        <AvatarEditor />
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Username</dt>
          <dd className="font-medium">{user.username}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="truncate font-medium">{user.email}</dd>
          <dt className="text-muted-foreground">Password</dt>
          <dd className="flex items-center justify-between gap-2">
            <span className="font-medium tracking-widest">••••••••</span>
            {!changing && (
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => setChanging(true)}>
                Change password
              </Button>
            )}
          </dd>
        </dl>
        {changing && <PasswordForm onDone={() => setChanging(false)} />}
      </CardContent>
    </Card>
  )
}

function PreferencesCard() {
  const user = useUser()
  const { refresh } = useAuth()
  const [household, setHousehold] = useState(user.household_size)
  const [preferences, setPreferences] = useState(user.preferences)

  async function save() {
    try {
      await api('/api/me/profile', { method: 'PUT', json: { household_size: household, preferences } })
      await refresh()
      toast.success('Preferences saved')
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  return (
    <Card>
      <SectionTitle description="Used to size and suggest your meals.">Household &amp; tastes</SectionTitle>
      <CardContent className="space-y-6">
        <HouseholdInput value={household} onChange={setHousehold} />
        <PreferencesFields value={preferences} onChange={setPreferences} />
        <Button className="rounded-full" onClick={save}>
          Save preferences
        </Button>
      </CardContent>
    </Card>
  )
}

type LinkEntry = { id: number; user_id: number; username: string; avatar: string | null }
type Links = { incoming: LinkEntry[]; outgoing: LinkEntry[]; linked: LinkEntry[] }

function LinkRow({ entry, label, children }: { entry: LinkEntry; label?: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60">
      <UserAvatar username={entry.username} avatar={entry.avatar} />
      <span className="flex-1 truncate font-medium">{entry.username}</span>
      {label && <Badge variant="secondary">{label}</Badge>}
      {children}
    </li>
  )
}

function LinksCard() {
  const [links, setLinks] = useState<Links>({ incoming: [], outgoing: [], linked: [] })
  const [username, setUsername] = useState('')
  const load = useCallback(() => api<Links>('/api/links').then(setLinks), [])
  useEffect(() => void load().catch(() => {}), [load])

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action()
      toast.success(message)
      await load()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  function send(e: FormEvent) {
    e.preventDefault()
    const name = username.trim()
    if (!name) return
    void run(() => api('/api/links', { method: 'POST', json: { username: name } }), `Request sent to ${name}`).then(() =>
      setUsername(''),
    )
  }

  const remove = (l: LinkEntry, message: string) => run(() => api(`/api/links/${l.id}`, { method: 'DELETE' }), message)
  const empty = !links.incoming.length && !links.outgoing.length && !links.linked.length

  return (
    <Card>
      <SectionTitle description="Share budgets and chores with people in your home.">Linked accounts</SectionTitle>
      <CardContent className="space-y-4">
        <form onSubmit={send} className="flex gap-2">
          <Input aria-label="Username to link" placeholder="Their username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Button type="submit" className="rounded-full">
            <UserPlus /> Send request
          </Button>
        </form>
        {empty && <p className="text-sm text-muted-foreground">No linked accounts yet.</p>}
        <ul className="space-y-1">
          {links.incoming.map((l) => (
            <LinkRow key={l.id} entry={l} label="Wants to link">
              <Button
                size="icon-sm"
                className="rounded-full"
                aria-label={`Accept ${l.username}`}
                onClick={() => run(() => api(`/api/links/${l.id}/accept`, { method: 'POST' }), `Linked with ${l.username}`)}
              >
                <Check />
              </Button>
              <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={`Decline ${l.username}`} onClick={() => remove(l, 'Request declined')}>
                <X />
              </Button>
            </LinkRow>
          ))}
          {links.outgoing.map((l) => (
            <LinkRow key={l.id} entry={l} label="Pending">
              <Button size="sm" variant="ghost" className="rounded-full" aria-label={`Cancel request to ${l.username}`} onClick={() => remove(l, 'Request cancelled')}>
                Cancel
              </Button>
            </LinkRow>
          ))}
          {links.linked.map((l) => (
            <LinkRow key={l.id} entry={l}>
              <Button size="sm" variant="ghost" className="rounded-full text-destructive" aria-label={`Unlink ${l.username}`} onClick={() => remove(l, `Unlinked ${l.username}`)}>
                Unlink
              </Button>
            </LinkRow>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function AccountPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1>Account</h1>
        <p className="mt-1 text-muted-foreground">Your profile, household and the people you share with.</p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <ProfileCard />
          <LinksCard />
        </div>
        <PreferencesCard />
      </div>
    </div>
  )
}
