import { useEffect } from 'react'

export type AssistantContext = { month?: string; week_start?: string; partner_id?: number | null }
type Target = { context: AssistantContext; onChanged: () => void }

const none: Target = { context: {}, onChanged: () => {} }
let current = none

/** What the assistant panel sends with the next message, and what it calls after the assistant changed data. */
export const assistantTarget = () => current

/** Pages call this with what they show and how to reload it. */
export function useAssistant(context: AssistantContext, onChanged: () => void) {
  useEffect(() => {
    const mine = { context, onChanged }
    current = mine
    return () => {
      if (current === mine) current = none
    }
  })
}
