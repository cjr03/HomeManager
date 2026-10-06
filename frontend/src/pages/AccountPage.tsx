import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function AccountPage() {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <h1>Account</h1>
      </CardHeader>
      <CardContent className="text-muted-foreground">
        Your profile, today's chores and linked household members.
      </CardContent>
    </Card>
  )
}
