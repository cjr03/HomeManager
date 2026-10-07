import { Bot, Loader2, MessageCircle, Send, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { errorText, FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { assistantTarget } from '@/lib/assistant'
import { useAuth } from '@/lib/auth'
import { today } from '@/lib/month'
import { cn } from '@/lib/utils'

type Message = { role: 'user' | 'assistant'; content: string }

const HINTS: Record<string, string> = {
  meals: 'Add to the pantry, change preferences, plan meals or build the shopping list.',
  budget: "Add, change or remove lines in this month's plan, what you own and what you owe, or ask about the numbers.",
  calendar: 'Add, change or remove chores, and mark chores, tasks or events done.',
  account: "Mark today's chores or tasks done, or change your household preferences.",
}
const MAX_LENGTH = 4000

/** Chat about the current page. A sticky column on xl screens, a floating sheet on smaller ones. */
export function AssistantPanel() {
  const page = useLocation().pathname.split('/')[1]
  const { refresh } = useAuth()
  const [histories, setHistories] = useState<Record<string, Message[]>>({})
  const [draft, setDraft] = useState('')
  const [busyPage, setBusyPage] = useState<string | null>(null) // the page waiting on a reply
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const list = useRef<HTMLUListElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const messages = histories[page] ?? []
  const busy = busyPage === page

  useEffect(() => setError(''), [page])
  // The sheet below xl: focus moves in on open and back to the trigger on close; Escape closes it from anywhere.
  useEffect(() => {
    if (open) document.getElementById('assistant-message')?.focus()
    else if (wasOpen.current) trigger.current?.focus()
    wasOpen.current = open
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [messages.length, busy])

  if (!(page in HINTS)) return null

  async function send(e?: FormEvent) {
    e?.preventDefault()
    const content = draft.trim()
    if (!content || busy) return
    const sent = [...messages, { role: 'user' as const, content }]
    const set = (m: Message[]) => setHistories((h) => ({ ...h, [page]: m }))
    set(sent)
    setDraft('')
    setError('')
    setBusyPage(page)
    const { context } = assistantTarget()
    try {
      const res = await api<{ reply: string; changed: boolean }>('/api/assistant', {
        method: 'POST',
        // The API takes at most 40 messages, starting with the user's; history alternates, so 39 keeps that.
        json: {
          page,
          today: today(),
          context,
          messages: sent.slice(-39).map((m) => ({ ...m, content: m.content.slice(0, MAX_LENGTH) })),
        },
      })
      set([...sent, { role: 'assistant', content: res.reply }])
      if (res.changed) {
        assistantTarget().onChanged() // the page showing now, which may have remounted since sending
        await refresh()
      }
    } catch (err) {
      set(messages)
      setDraft((d) => d || content)
      setError(errorText(err))
    } finally {
      setBusyPage((p) => (p === page ? null : p))
    }
  }

  return (
    <>
      <Button
        ref={trigger}
        className="fixed right-4 bottom-24 z-40 size-12 rounded-full shadow-float sm:bottom-6 xl:hidden"
        aria-label="Open assistant"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MessageCircle className="size-5" />
      </Button>
      <aside
        aria-label="Assistant"
        className={cn(
          'fixed inset-x-3 top-3 bottom-24 z-50 sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-6 sm:h-[36rem] sm:w-96',
          'xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:block xl:h-[calc(100svh-2rem)] xl:w-auto',
          open ? 'block' : 'hidden',
        )}
      >
        <Card className="h-full gap-3 py-4">
          <div className="flex items-center gap-2 px-4">
            <span className="grid size-8 place-items-center rounded-full bg-accent text-accent-foreground">
              <Bot className="size-4" aria-hidden />
            </span>
            <h2 className="flex-1 font-semibold">Assistant</h2>
            <Button variant="ghost" size="icon-sm" className="rounded-full xl:hidden" aria-label="Close assistant" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
          <ul ref={list} aria-live="polite" className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 text-sm">
            {!messages.length && <li className="text-muted-foreground">{HINTS[page]}</li>}
            {messages.map((m, i) => (
              <li
                key={i}
                className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-wrap',
                  m.role === 'user' ? 'self-end bg-primary text-primary-foreground' : 'self-start bg-muted',
                )}
              >
                {m.content}
              </li>
            ))}
            {busy && (
              <li className="flex items-center gap-2 self-start text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Thinking…
              </li>
            )}
          </ul>
          <form onSubmit={send} className="space-y-2 px-4">
            <FormError>{error}</FormError>
            <div className="flex items-end gap-2">
              <label htmlFor="assistant-message" className="sr-only">
                Message the assistant
              </label>
              <Textarea
                id="assistant-message"
                rows={1}
                maxLength={MAX_LENGTH}
                placeholder="Ask or tell me what to change"
                className="max-h-32 min-h-10 resize-none"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <Button type="submit" size="icon" className="shrink-0 rounded-full" aria-label="Send" disabled={busy || !draft.trim()}>
                <Send />
              </Button>
            </div>
          </form>
        </Card>
      </aside>
    </>
  )
}
