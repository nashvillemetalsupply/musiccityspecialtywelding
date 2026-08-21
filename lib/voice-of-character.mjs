// The owner's voice, built out of what he actually said.
//
// Every word this shop sends outward -- a voicemail script, a text, a quote
// email, a line on the website, an ad headline -- should sound like the man who
// answers the phone. The only honest source for that is what he has already
// said, and the shop already stores it: `call_live_transcript_items` keeps
// every final utterance tagged by track, so the shop's half of a call is
// separable from the customer's, and his voice notes are his own words too.
// `voice_samples` is where those lines are kept as a corpus; this module turns
// the corpus into a profile, and the profile into a block of prompt text any
// drafting path can paste in.
//
// Nothing here calls a model. A frequency count over real sentences is cheap,
// exact and reviewable; an invented voice is the exact failure worth avoiding
// when the output goes out under the owner's name. The verbatim samples matter
// more than the statistics -- they are the voice itself, and they are what a
// drafting prompt should imitate.
//
// This is not worker measurement. One profile exists, it belongs to the owner,
// and it holds language, never activity. Nothing here counts anything per crew
// member, and nothing here can be turned into a ranking.

// Grams made only of these say nothing about how a man talks.
const STOP_WORDS = new Set([
  "a", "about", "all", "am", "an", "and", "any", "are", "as", "at", "be", "been",
  "but", "by", "can", "did", "do", "does", "for", "from", "get", "got", "had",
  "has", "have", "he", "her", "here", "him", "his", "how", "i", "if", "in", "is",
  "it", "its", "just", "me", "my", "no", "not", "of", "on", "one", "or", "our",
  "out", "so", "than", "that", "the", "them", "then", "there", "they", "this",
  "to", "too", "up", "us", "was", "we", "were", "what", "when", "where", "which",
  "who", "will", "with", "would", "you", "your",
])

// Spoken habits worth naming outright, because a drafting model will not pick
// them out of a phrase list on its own.
const TICS = [
  "yeah", "yep", "yes sir", "no problem", "for sure", "absolutely", "gotcha",
  "okay", "all right", "sure", "man", "buddy", "bud", "brother", "sir",
  "you know", "i mean", "let me", "hang on", "real quick", "no worries",
  "appreciate it", "thank you", "sounds good", "we can", "i can",
  "probably", "pretty much", "basically",
]

// A transcript rarely carries punctuation, so a question is mostly recognised
// by how the sentence starts.
const QUESTION_OPENERS = new Set([
  "what", "when", "where", "why", "how", "who", "which", "do", "does", "did",
  "is", "are", "was", "were", "can", "could", "would", "will", "should", "have",
  "has", "any",
])

const CONTRACTION = /\b[a-z]+'(?:s|t|re|ve|ll|d|m)\b/i

// A line of pure noise teaches nothing, and a transcript is full of it.
const MIN_SAMPLE_WORDS = 4
const MAX_SAMPLE_WORDS = 40
const MAX_SAMPLES = 12

// How long a repeated run of words is allowed to be before it stops being a
// phrase and starts being a whole sentence. Four was too short to hold "give me
// about two weeks on it" -- which is the habit -- so the window is the sentence
// he actually repeats, and the subsumption pass below throws away the fragments
// inside it.
const MAX_GRAM = 8

function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

export function normalizeLine(text) {
  return words(text).join(" ")
}

function tidy(text) {
  const trimmed = String(text ?? "").replace(/\s+/g, " ").trim()
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function topCounted(counts, limit) {
  return [...counts.entries()]
    .map(([text, entry]) => ({ text: entry.display ?? text, count: entry.count, sources: entry.sources.size }))
    .sort((a, b) => b.count - a.count || b.sources - a.sources || a.text.localeCompare(b.text))
    .slice(0, limit)
}

// Two lines are the same greeting whether he said it Tuesday or Friday, so the
// key is the normalized text and the display is how he first said it.
function bump(counts, key, display, sourceRef) {
  const entry = counts.get(key) ?? { count: 0, display, sources: new Set() }
  entry.count += 1
  entry.sources.add(sourceRef)
  counts.set(key, entry)
}

// A source is one call, one voice note, one pasted piece of his writing. The
// grouping is what keeps a single long call from looking like a habit.
function linesBySource(lines) {
  const sources = new Map()
  for (const item of lines ?? []) {
    const text = String(item?.text ?? "").replace(/\s+/g, " ").trim()
    // A test call is a test call everywhere. It never becomes the owner's voice.
    if (!text || text.includes("[INTERNAL TEST]")) continue
    const sourceRef = String(item.sourceRef ?? "")
    const kept = sources.get(sourceRef) ?? []
    kept.push(text)
    sources.set(sourceRef, kept)
  }
  return sources
}

export function emptyVoiceProfile() {
  return {
    speaker: "owner",
    displayName: "",
    sourceCount: 0,
    lineCount: 0,
    wordCount: 0,
    wordsPerLine: 0,
    questionRate: 0,
    contractionRate: 0,
    openers: [],
    closers: [],
    phrases: [],
    tics: [],
    vocabulary: [],
    samples: [],
  }
}

export function deriveVoiceProfile(lines, options = {}) {
  const profile = emptyVoiceProfile()
  profile.displayName = String(options.displayName ?? "").trim()
  const sources = linesBySource(lines)
  if (sources.size === 0) return profile

  const openers = new Map()
  const closers = new Map()
  const grams = new Map()
  const tics = new Map()
  const vocabulary = new Map()
  const samples = []
  let questions = 0
  let contractions = 0

  for (const [sourceRef, spoken] of sources) {
    profile.sourceCount += 1
    bump(openers, normalizeLine(spoken[0]), tidy(spoken[0]), sourceRef)
    bump(closers, normalizeLine(spoken[spoken.length - 1]), tidy(spoken[spoken.length - 1]), sourceRef)

    for (const line of spoken) {
      const parts = words(line)
      if (!parts.length) continue
      profile.lineCount += 1
      profile.wordCount += parts.length
      if (line.includes("?") || QUESTION_OPENERS.has(parts[0])) questions += 1
      if (CONTRACTION.test(line)) contractions += 1

      for (const word of parts) {
        if (STOP_WORDS.has(word) || word.length < 3) continue
        bump(vocabulary, word, word, sourceRef)
      }
      const flat = ` ${parts.join(" ")} `
      for (const tic of TICS) {
        if (flat.includes(` ${tic} `)) bump(tics, tic, tic, sourceRef)
      }
      for (let size = 2; size <= MAX_GRAM; size += 1) {
        for (let start = 0; start + size <= parts.length; start += 1) {
          const gram = parts.slice(start, start + size)
          if (gram.every((word) => STOP_WORDS.has(word))) continue
          bump(grams, gram.join(" "), gram.join(" "), sourceRef)
        }
      }
      if (parts.length >= MIN_SAMPLE_WORDS && parts.length <= MAX_SAMPLE_WORDS) {
        samples.push({ sourceRef, text: tidy(line) })
      }
    }
  }

  profile.wordsPerLine = profile.lineCount ? Number((profile.wordCount / profile.lineCount).toFixed(1)) : 0
  profile.questionRate = profile.lineCount ? Number((questions / profile.lineCount).toFixed(2)) : 0
  profile.contractionRate = profile.lineCount ? Number((contractions / profile.lineCount).toFixed(2)) : 0
  profile.openers = topCounted(openers, 6)
  profile.closers = topCounted(closers, 6)
  profile.tics = topCounted(tics, 12)
  profile.vocabulary = topCounted(vocabulary, 20)
  profile.phrases = keptPhrases(grams, profile.sourceCount)
  profile.samples = pickSamples(samples)
  return profile
}

// A phrase earns its place by recurring -- across sources once there are two of
// them, and within the one source while that is all the shop has. The longer
// gram wins over the shorter one it contains when both were said the same
// number of times, because "give me a call back" is the habit and "a call"
// is not.
function keptPhrases(grams, sourceCount) {
  const repeated = topCounted(grams, 400)
    .filter((entry) => (sourceCount >= 2 ? entry.sources >= 2 : entry.count >= 2))
  const kept = []
  for (const entry of repeated) {
    const subsumed = repeated.some((other) =>
      other !== entry &&
      other.text.length > entry.text.length &&
      other.count >= entry.count &&
      ` ${other.text} `.includes(` ${entry.text} `))
    if (!subsumed) kept.push(entry)
  }
  return kept.slice(0, 15)
}

// Spread the verbatim samples over the sources the shop has, so one long call
// cannot become the whole personality.
function pickSamples(samples) {
  const bySource = new Map()
  for (const sample of samples) {
    const list = bySource.get(sample.sourceRef) ?? []
    list.push(sample)
    bySource.set(sample.sourceRef, list)
  }
  // Deduplicated: he answers the phone the same way every time, and a slot
  // spent on the second copy of his greeting is a slot not spent on his voice.
  const picked = []
  const seen = new Set()
  let round = 0
  let added = true
  while (picked.length < MAX_SAMPLES && added) {
    added = false
    for (const list of bySource.values()) {
      const sample = list[round]
      if (!sample) continue
      added = true
      const key = normalizeLine(sample.text)
      if (seen.has(key)) continue
      seen.add(key)
      picked.push(sample.text)
      if (picked.length >= MAX_SAMPLES) break
    }
    round += 1
  }
  return picked
}

// Below this there is not enough of him on record to imitate, and a thin
// profile is worse than none: it would put invented cadence in his mouth on a
// page a customer reads.
export function voiceProfileIsUsable(profile) {
  return Boolean(profile) &&
    Number(profile.lineCount) >= 8 &&
    Array.isArray(profile.samples) &&
    profile.samples.length > 0
}

// The block a drafting prompt pastes in. Deliberately short on statistics and
// long on his own sentences: a model imitates an example far better than it
// obeys a number.
export function voiceStyleGuide(profile) {
  if (!voiceProfileIsUsable(profile)) return ""
  const name = String(profile.displayName || "the owner").trim()
  const quoted = (entries, limit) => entries.slice(0, limit).map((entry) => `"${entry.text}"`).join(" / ")
  const lines = [
    `How ${name} talks, taken from ${profile.lineCount} of his own lines across ${profile.sourceCount} recorded call${profile.sourceCount === 1 ? "" : "s"} and note${profile.sourceCount === 1 ? "" : "s"}:`,
  ]
  if (profile.openers.length) lines.push(`- He opens with: ${quoted(profile.openers, 3)}`)
  if (profile.closers.length) lines.push(`- He signs off with: ${quoted(profile.closers, 3)}`)
  if (profile.phrases.length) lines.push(`- Phrases he reuses: ${profile.phrases.slice(0, 8).map((entry) => `"${entry.text}"`).join(", ")}`)
  if (profile.tics.length) lines.push(`- Habits: ${profile.tics.slice(0, 8).map((entry) => entry.text).join(", ")}`)
  lines.push(`- His sentences run about ${profile.wordsPerLine} words. ${Math.round(profile.questionRate * 100)} of every 100 are a question, and ${Math.round(profile.contractionRate * 100)} of 100 carry a contraction.`)
  lines.push("")
  lines.push("His own words, verbatim:")
  for (const sample of profile.samples.slice(0, 10)) lines.push(`  "${sample}"`)
  lines.push("")
  lines.push(`Write it as ${name} would say it: same plain words, same length, contractions kept, no marketing language, and nothing he would never say. Say only what the shop's own facts support -- sounding like him is never a licence to invent one.`)
  return lines.join("\n")
}
