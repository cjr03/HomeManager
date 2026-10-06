import { Check, House } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { Field, FormError } from '@/components/Field'
import { DEFAULT_PREFERENCES, HouseholdInput, PreferencesFields } from '@/components/ProfileFields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

type Account = { email: string; username: string; password: string; password_confirm: string }
type Errors = Partial<Record<keyof Account, string>>

export function validateAccount(a: Account): Errors {
  const e: Errors = {}
  if (!/^\S+@\S+\.\S+$/.test(a.email)) e.email = 'Enter a valid email'
  if (!/^[A-Za-z0-9_]{3,32}$/.test(a.username)) e.username = '3–32 letters, numbers or underscores'
  if (a.password.length < 8) e.password = 'Use at least 8 characters'
  else if (a.password !== a.password_confirm) e.password_confirm = 'Passwords do not match'
  return e
}

const errorText = (err: unknown) => (err instanceof ApiError ? err.detail : 'Something went wrong, try again')

function LoginForm() {
  const { refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/login', { method: 'POST', json: { username, password } })
      await refresh()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field id="login-username" label="Username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
      <Field id="login-password" label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <FormError>{error}</FormError>
      <Button type="submit" className="w-full rounded-full" size="lg" disabled={busy}>
        Log in
      </Button>
    </form>
  )
}

const STEPS = ['Account', 'Household', 'Tastes']

function SignupForm() {
  const { refresh } = useAuth()
  const [step, setStep] = useState(0)
  const [account, setAccount] = useState<Account>({ email: '', username: '', password: '', password_confirm: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [household, setHousehold] = useState(1)
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const field = (key: keyof Account) => ({
    value: account[key],
    error: errors[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setAccount({ ...account, [key]: e.target.value }),
  })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (step === 0) {
      const errs = validateAccount(account)
      setErrors(errs)
      if (Object.keys(errs).length) return
    }
    setError('')
    if (step < STEPS.length - 1) return setStep(step + 1)
    setBusy(true)
    try {
      await api('/api/auth/signup', {
        method: 'POST',
        json: { ...account, household_size: household, preferences },
      })
      await refresh()
    } catch (err) {
      setError(errorText(err))
      if (err instanceof ApiError && err.status === 409) setStep(0)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <ol aria-label="Sign-up progress" className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined} className="flex flex-1 items-center gap-2 text-sm">
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors duration-300',
                i < step && 'border-primary bg-primary text-primary-foreground',
                i === step && 'border-primary text-primary ring-4 ring-primary/15',
                i > step && 'text-muted-foreground',
              )}
            >
              {i < step ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
            <span className={cn('font-medium', i !== step && 'text-muted-foreground')}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      <div key={step} className="animate-in space-y-4 duration-300 fade-in slide-in-from-right-4">
        {step === 0 && (
          <>
            <Field id="email" label="Email" type="email" autoComplete="email" {...field('email')} />
            <Field id="username" label="Username" autoComplete="username" {...field('username')} />
            <Field id="password" label="Password" type="password" autoComplete="new-password" {...field('password')} />
            <Field id="password_confirm" label="Confirm password" type="password" autoComplete="new-password" {...field('password_confirm')} />
          </>
        )}
        {step === 1 && (
          <>
            <p className="text-muted-foreground">Who are you cooking for? We'll size meals and shopping lists to match.</p>
            <HouseholdInput value={household} onChange={setHousehold} />
          </>
        )}
        {step === 2 && (
          <>
            <p className="text-muted-foreground">A few quick questions so meal ideas suit your table.</p>
            <PreferencesFields value={preferences} onChange={setPreferences} />
          </>
        )}
      </div>

      <FormError>{error}</FormError>
      <div className="flex gap-2">
        {step > 0 && (
          <Button type="button" variant="outline" size="lg" className="rounded-full" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        <Button type="submit" size="lg" className="flex-1 rounded-full" disabled={busy}>
          {step < STEPS.length - 1 ? 'Next' : 'Create account'}
        </Button>
      </div>
    </form>
  )
}

export function LoginPage() {
  const { user } = useAuth()
  if (user) return <Navigate to="/meals" replace />
  return (
    <main className="grid min-h-svh place-items-center px-4 py-10">
      <Card className="w-full max-w-md animate-in duration-500 fade-in zoom-in-95">
        <CardHeader className="gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-float">
            <House className="size-6" aria-hidden />
          </span>
          <h1>Welcome to HomeManager</h1>
          <p className="text-muted-foreground">Plan meals, budgets and chores with your household.</p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="gap-5">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Log in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <LoginForm />
            </TabsContent>
            <TabsContent value="signup">
              <SignupForm />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  )
}
