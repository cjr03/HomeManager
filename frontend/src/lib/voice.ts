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

// Her own voice is Kokoro, an open neural model that sounds like a person, run on the GPU in the browser: no account,
// and what she says never leaves the machine. It starts loading on the first mic click; until it's ready, and
// where there's no WebGPU, she uses the browser's voice above.
type Made = { audio?: Float32Array; sampling_rate?: number } // no audio: that sentence failed
let worker: Worker | undefined
let neural = false
let audio: AudioContext | undefined
let playing: AudioBufferSourceNode[] = []
let said = 0 // bumped on every stop, so sentences still being made aren't played
const waiting: ((out: Made) => void)[] = [] // the worker answers in the order it was asked

function make(text: string) {
  worker!.postMessage(text)
  return new Promise<Made>((resolve) => waiting.push(resolve))
}

// The model silently drops the end of anything over ~500 sounds, so long sentences are split again at , ; or :
// ponytail: a 300+ character run with none of those is still cut; split on words if replies ever do that.
const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .flatMap((s) => (s.length > 300 ? s.split(/(?<=[,;:])\s+/) : [s]))
    .filter((s) => s.trim())

/** Stop her talking in either voice, including sentences not yet played. */
export function stop() {
  said++
  for (const source of playing) {
    source.onended = null
    source.stop()
  }
  playing = []
  window.speechSynthesis?.cancel()
}

/** Read the text out word for word, stopping whatever was still being said. `done` runs once she finishes. */
export function speak(text: string, done: () => void) {
  stop()
  const sentences = sentencesOf(text)
  if (neural && audio) void speakNeural(sentences, audio, done)
  else speakBrowser(sentences, done)
}

// Each sentence is made while the one before plays, and queued right after it.
async function speakNeural(sentences: string[], ctx: AudioContext, done: () => void) {
  const turn = said
  let at = 0
  for (const [i, sentence] of sentences.entries()) {
    const out = await make(sentence)
    if (turn !== said) return
    if (!out.audio) {
      // The rest in the browser's voice, once what's already queued has been said.
      const rest = () => turn === said && speakBrowser(sentences.slice(i), done)
      const last = playing.at(-1)
      return last ? void (last.onended = rest) : rest()
    }
    const buffer = ctx.createBuffer(1, out.audio.length, out.sampling_rate!)
    buffer.copyToChannel(out.audio as Float32Array<ArrayBuffer>, 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    at = Math.max(at, ctx.currentTime)
    source.start(at)
    at += buffer.duration
    playing.push(source)
    if (i === sentences.length - 1) source.onended = () => turn === said && done()
  }
}

function speakBrowser(sentences: string[], done: () => void) {
  const synth = window.speechSynthesis
  if (!synth) return
  const voice = pickVoice(synth.getVoices())
  // Chrome cuts off utterances after about 15s, so queue one per sentence.
  sentences.forEach((sentence, i) => {
    const u = new SpeechSynthesisUtterance(sentence)
    u.rate = RATE
    u.lang = 'en-US'
    if (voice) u.voice = voice
    if (i === sentences.length - 1) u.onend = u.onerror = () => done()
    synth.speak(u)
  })
}

/** Call from a click: stops her talking, starts loading her voice, and unlocks audio (iOS) for the reply that follows. */
export function prime() {
  stop()
  if (window.AudioContext && window.Worker && 'gpu' in navigator) {
    audio ??= new AudioContext()
    void audio.resume()
    if (!worker) {
      worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }) => {
        if ('ready' in data) neural = data.ready
        else waiting.shift()?.(data)
      }
    }
  }
  const synth = window.speechSynthesis
  if (!synth) return
  synth.getVoices()
  synth.speak(new SpeechSynthesisUtterance(''))
}
