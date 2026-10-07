import { toast } from 'sonner'
import { errorText } from '@/components/Field'
import { UserAvatar } from '@/components/UserAvatar'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

export type Person = { id: number; username: string; avatar: string | null }
export type Occurrence = { chore_id: number; title: string; date: string; assignee: Person; owner_id: number; done: boolean }

/** A chore occurrence with a done checkbox; calls onChange(done) once the server has saved it. */
export function ChoreCheck({ chore, onChange }: { chore: Occurrence; onChange: (done: boolean) => void }) {
  async function toggle(done: boolean) {
    try {
      await api(`/api/chores/${chore.chore_id}/done/${chore.date}`, { method: done ? 'POST' : 'DELETE' })
      onChange(done)
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60">
      <input
        type="checkbox"
        checked={chore.done}
        onChange={(e) => void toggle(e.target.checked)}
        className="size-4 shrink-0 cursor-pointer accent-primary"
      />
      <span className={cn('flex-1 truncate font-medium transition-colors', chore.done && 'text-muted-foreground line-through')}>
        {chore.title}
      </span>
      <UserAvatar username={chore.assignee.username} avatar={chore.assignee.avatar} className="size-6 text-xs" />
    </label>
  )
}
