// Talking to Mikayla with the browser's own speech services: no dependency, no server round trip.

/** The part of SpeechRecognition the panel uses (TypeScript's DOM lib types the events but not the class). */
export interface Recognition {
  lang: string
  interimResults: boolean
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** The browser's speech recognizer, or undefined where it has none (Firefox). */
export function recognizer(): (new () => Recognition) | undefined {
  const w = window as unknown as Record<string, (new () => Recognition) | undefined>
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export const RATE = 1.3
// Clear, polished US English voices, best first: macOS, Windows, then Chrome's.
const VOICES = ['Ava', 'Samantha', 'Microsoft Aria', 'Microsoft Jenny', 'Google US English']

export function pickVoice(voices: SpeechSynthesisVoice[]) {
  const us = voices.filter((v) => v.lang.replace('_', '-') === 'en-US')
  for (const name of VOICES) {
    const voice = us.find((v) => v.name.startsWith(name))
    if (voice) return voice
  }
  return us[0]
}

/** Read the text out word for word, stopping whatever was still being said. `done` runs once she finishes. */
export function speak(text: string, done: () => void) {
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel()
  const voice = pickVoice(synth.getVoices())
  // Chrome cuts off utterances after about 15s, so queue one per sentence.
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim())
  sentences.forEach((sentence, i) => {
    const u = new SpeechSynthesisUtterance(sentence)
    u.rate = RATE
    u.lang = 'en-US'
    if (voice) u.voice = voice
    if (i === sentences.length - 1) u.onend = u.onerror = () => done()
    synth.speak(u)
  })
}

/** Call from a click: stops her talking, starts loading voices, and unlocks speech on iOS for the reply that follows. */
export function prime() {
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel()
  synth.getVoices()
  synth.speak(new SpeechSynthesisUtterance(''))
}
