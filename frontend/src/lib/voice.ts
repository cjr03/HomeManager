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
// Her voice is always a woman's. Most human first: neural voices (Edge's "Natural"/"Online", macOS's downloadable
// Premium/Enhanced) of any of these, then the plain ones in this order. Chrome's Google voice beats macOS's Samantha.
const FEMALE = ['Ava', 'Zoe', 'Allison', 'Susan', 'Jenny', 'Aria', 'Emma', 'Michelle', 'Google US English', 'Samantha', 'Zira']
const HUMAN = /Natural|Online|Premium|Enhanced/

function rank(v: SpeechSynthesisVoice) {
  const i = FEMALE.findIndex((name) => v.name.replace('Microsoft ', '').startsWith(name))
  return i < 0 ? Infinity : HUMAN.test(v.name) ? i : i + FEMALE.length
}

/** The most human-sounding US English woman's voice, or undefined to leave it to the browser. */
export function pickVoice(voices: SpeechSynthesisVoice[]) {
  return voices
    .filter((v) => v.lang.replace('_', '-') === 'en-US' && rank(v) < Infinity)
    .sort((a, b) => rank(a) - rank(b))[0]
}

// Speech recognition doesn't know her name and spells it every other way.
const NAME = /\b(?:Michaela|Micaela|Mikaela|Makayla|Mckayla|Mykayla|Michela|Mikela|Mihaela|Mikhaela)\b/gi

/** What was heard, with her name spelled right. */
export const spellMikayla = (text: string) => text.replace(NAME, 'Mikayla')

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
