import { House } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function LoginPage() {
  return (
    <main className="grid min-h-svh place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <House className="size-6" aria-hidden />
          </span>
          <h1>Welcome to HomeManager</h1>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          Log in or create an account to plan meals, budgets and chores with your household.
        </CardContent>
      </Card>
    </main>
  )
}
