import type { Register } from 'claude-code'

type Mode = 'insert' | 'normal' | 'select'
type Sel = { anchor: number; head: number }
// The draft and its selections, sorted and apart; `primary` indexes the one `cursor` follows
type Box = { text: string; cursor: number; sels: Sel[]; primary: number }
type Out = Box & { to?: Mode }
// Replaces [start, end) with `insert`; the selection lands relative to where `insert` begins
type Edit = { start: number; end: number; insert: string; anchorRel: number; headRel: number }
// A key that waits for the next one: `g` goto, `m` match (`mi`/`ma` then pick a text object),
// `f`/`t`/`F`/`T` find a character, `s` select every occurrence of one inside the selections,
// `r` replace the selected characters with one
type Pending = '' | 'g' | 'm' | 'mi' | 'ma' | 'f' | 't' | 'F' | 'T' | 's' | 'r'

const PRIMARY = { backgroundColor: 'blue' } as const
const SECONDARY = { backgroundColor: 'cyan' } as const
const STATUS: Record<Mode, string | undefined> = {
  insert: undefined,
  normal: '-- NORMAL --',
  select: '-- SELECT --',
}
const HISTORY_LIMIT = 100
const INDENT = '  '
const PAIRS = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  [')', '('],
  [']', '['],
  ['}', '{'],
])
const OPENERS = '([{'
// Text objects `mi`/`ma` take, by the key that names them (`b`, `B` are Helix's aliases)
const OBJECT_PAIRS = new Map<string, readonly [string, string]>([
  ['(', ['(', ')']],
  [')', ['(', ')']],
  ['b', ['(', ')']],
  ['[', ['[', ']']],
  [']', ['[', ']']],
  ['{', ['{', '}']],
  ['}', ['{', '}']],
  ['B', ['{', '}']],
  ['<', ['<', '>']],
  ['>', ['<', '>']],
])

const isBlank = (c: string) => c === ' ' || c === '\t'
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const isSpace = (c: string) => /\s/.test(c)
const isWord = (c: string) => /[\p{L}\p{M}\p{N}_]/u.test(c)

const lineStart = (t: string, i: number) => t.lastIndexOf('\n', i - 1) + 1
// Index of the line's newline (inclusive end of the line), or the last char
const lineEnd = (t: string, i: number) => {
  const n = t.indexOf('\n', i)
  return n === -1 ? t.length - 1 : n
}
// Index of the last character on the line, not counting its newline
const lineLast = (t: string, i: number) => {
  const end = lineEnd(t, i)
  return t.charAt(end) === '\n' && end > lineStart(t, i) ? end - 1 : end
}

const bounds = (s: Sel) => ({ lo: Math.min(s.anchor, s.head), hi: Math.max(s.anchor, s.head) })
const caret = (head: number): Sel => ({ anchor: head, head })

// What a character counts as for word motions: 0 blank, 1 word, 2 punctuation, 3 newline
const kindOf = (c: string) => (c === '\n' ? 3 : isSpace(c) ? 0 : isWord(c) ? 1 : 2)

// Helix's `w`: the word or punctuation run, with the blanks after it. Mid-word the selection
// starts at the cursor; from a word's last character, or from blanks, it starts at the next one.
function nextWord(t: string, from: number): Sel {
  if (from + 1 >= t.length) return caret(t.length - 1)
  const k = kindOf(t.charAt(from))
  const isRun = k === 1 || k === 2
  const isMidWord = isRun && kindOf(t.charAt(from + 1)) === k
  // A one-character word followed by blanks is still a whole word, and taking them moves on
  const isLone = isRun && !isMidWord && kindOf(t.charAt(from - 1)) !== k && isBlank(t.charAt(from + 1))
  const anchor = isMidWord || isLone ? from : from + 1
  const kind = kindOf(t.charAt(anchor))
  let head = anchor
  while (head + 1 < t.length && kindOf(t.charAt(head + 1)) === kind) head++
  if (kind === 1 || kind === 2) {
    while (isBlank(t.charAt(head + 1))) head++
  }
  return { anchor, head }
}

function wordEnd(t: string, from: number): Sel {
  let i = from + 1
  while (i < t.length && isSpace(t.charAt(i))) i++
  if (i >= t.length) return caret(t.length - 1)
  const start = i
  while (i + 1 < t.length && !isSpace(t.charAt(i + 1)) && isWord(t.charAt(i + 1)) === isWord(t.charAt(start))) i++
  // Mid-word, the selection runs on from the cursor instead of skipping to the next word
  const continuesWord = start === from + 1 && !isSpace(t.charAt(from)) && isWord(t.charAt(from)) === isWord(t.charAt(start))
  return { anchor: continuesWord ? from : start, head: i }
}

// Helix's `b`, the mirror of `w`: the word or punctuation run with the blanks before it. Mid-word
// the selection starts at the cursor; from a word's first character, or from blanks, it starts at
// the previous one.
function prevWord(t: string, from: number): Sel {
  if (from === 0) return caret(0)
  const k = kindOf(t.charAt(from))
  const isRun = k === 1 || k === 2
  const isMidWord = isRun && kindOf(t.charAt(from - 1)) === k
  // A one-character word after blanks is still a whole word, and taking them moves on
  const isLone = isRun && !isMidWord && kindOf(t.charAt(from + 1)) !== k && isBlank(t.charAt(from - 1))
  const anchor = isMidWord || isLone ? from : from - 1
  const kind = kindOf(t.charAt(anchor))
  let head = anchor
  while (head > 0 && kindOf(t.charAt(head - 1)) === kind) head--
  if (kind === 1 || kind === 2) {
    while (isBlank(t.charAt(head - 1))) head--
  }
  return { anchor, head }
}

// Index of the `other` that closes the `self` at `from`, scanning in `dir`, or -1
function pairedWith(t: string, from: number, dir: 1 | -1, self: string, other: string): number {
  let depth = 0
  for (let i = from; i >= 0 && i < t.length; i += dir) {
    const c = t.charAt(i)
    if (c === self) depth++
    else if (c === other && --depth === 0) return i
  }
  return -1
}

// Index of the bracket pairing the one at `at`, or -1
function matchBracket(t: string, at: number): number {
  const open = t.charAt(at)
  const close = PAIRS.get(open)
  if (close === undefined) return -1
  return pairedWith(t, at, OPENERS.includes(open) ? 1 : -1, open, close)
}

// Index `f`/`t`/`F`/`T` lands on for the `n`th `ch`, searching from `from`, or -1
function findChar(t: string, from: number, ch: string, kind: 'f' | 't' | 'F' | 'T', n: number): number {
  const isForward = kind === 'f' || kind === 't'
  let at = from
  for (let k = 0; k < n; k++) {
    const i = isForward ? t.indexOf(ch, at + 1) : at === 0 ? -1 : t.lastIndexOf(ch, at - 1)
    if (i === -1) return -1
    at = i
  }
  return kind === 't' ? at - 1 : kind === 'T' ? at + 1 : at
}

// The word, or with `isBig` the run of non-space, under `at`; `around` takes the spaces after it
// (before it when none follow)
function wordObject(t: string, at: number, around: boolean, isBig: boolean): Sel | undefined {
  if (at >= t.length) return undefined
  const kind = (c: string) => (c === '\n' ? 3 : isSpace(c) ? 0 : isBig || isWord(c) ? 1 : 2)
  const k = kind(t.charAt(at))
  let anchor = at
  let head = at
  while (anchor > 0 && kind(t.charAt(anchor - 1)) === k) anchor--
  while (head + 1 < t.length && kind(t.charAt(head + 1)) === k) head++
  if (!around || k === 0 || k === 3) return { anchor, head }
  if (isBlank(t.charAt(head + 1))) {
    while (isBlank(t.charAt(head + 1))) head++
  } else {
    while (isBlank(t.charAt(anchor - 1))) anchor--
  }
  return { anchor, head }
}

// The text between the pair of `open`/`close` around `at` (nested pairs counted), or the pair too
function pairObject(t: string, at: number, open: string, close: string, around: boolean): Sel | undefined {
  const c = t.charAt(at)
  let start = -1
  if (c === open) {
    start = at
  } else if (c === close) {
    start = pairedWith(t, at, -1, close, open)
  } else {
    let depth = 0
    for (let i = at - 1; i >= 0; i--) {
      const ch = t.charAt(i)
      if (ch === close) depth++
      else if (ch === open && depth-- === 0) {
        start = i
        break
      }
    }
  }
  if (start === -1) return undefined
  const end = pairedWith(t, start, 1, open, close)
  if (end === -1) return undefined
  if (around) return { anchor: start, head: end }
  return end - start > 1 ? { anchor: start + 1, head: end - 1 } : undefined
}

// The text between the quotes pairing up on the line around `at` (a backslash escapes a quote)
function quoteObject(t: string, at: number, quote: string, around: boolean): Sel | undefined {
  const from = lineStart(t, at)
  const nl = t.indexOf('\n', at)
  const marks: number[] = []
  for (let i = from; i < (nl === -1 ? t.length : nl); i++) {
    if (t.charAt(i) === quote && t.charAt(i - 1) !== '\\') marks.push(i)
  }
  let open = -1
  for (const i of marks) {
    if (open === -1) {
      open = i
      continue
    }
    if (open <= at && at <= i) {
      if (around) return { anchor: open, head: i }
      return i - open > 1 ? { anchor: open + 1, head: i - 1 } : undefined
    }
    open = -1
  }
  return undefined
}

// The lines around `at` up to the blank ones; `around` takes the blank lines after them too
function paragraphObject(t: string, at: number, around: boolean): Sel | undefined {
  const isBlankLine = (from: number, to: number) => t.slice(from, to).trim() === ''
  const endOf = (from: number) => {
    const nl = t.indexOf('\n', from)
    return nl === -1 ? t.length : nl
  }
  let start = lineStart(t, at)
  let end = endOf(at)
  if (isBlankLine(start, end)) return undefined
  while (start > 0 && !isBlankLine(lineStart(t, start - 1), start - 1)) start = lineStart(t, start - 1)
  while (end < t.length && !isBlankLine(end + 1, endOf(end + 1))) end = endOf(end + 1)
  let head = end - 1
  if (around) {
    while (end < t.length && isBlankLine(end + 1, endOf(end + 1))) end = endOf(end + 1)
    head = Math.min(end, t.length - 1)
  }
  return { anchor: start, head }
}

function textObject(t: string, at: number, key: string, around: boolean): Sel | undefined {
  switch (key) {
    case 'w':
    case 'W':
      return wordObject(t, at, around, key === 'W')
    case '"':
    case "'":
    case '`':
      return quoteObject(t, at, key, around)
    case 'p':
      return paragraphObject(t, at, around)
    default: {
      const pair = OBJECT_PAIRS.get(key)
      return pair && pairObject(t, at, pair[0], pair[1], around)
    }
  }
}

function vertical(t: string, head: number, dir: 1 | -1): number {
  const col = head - lineStart(t, head)
  let start: number
  if (dir === 1) {
    const end = lineEnd(t, head)
    if (t.charAt(end) !== '\n') return head
    start = Math.min(end + 1, t.length - 1)
  } else {
    const own = lineStart(t, head)
    if (own === 0) return head
    start = lineStart(t, own - 1)
  }
  const nl = t.indexOf('\n', start)
  const last = (nl === -1 ? t.length : nl) - 1
  return clamp(start + col, start, Math.max(start, last))
}

function selectLine(t: string, s: Sel): Sel {
  const { lo, hi } = bounds(s)
  const isWholeLines = lo === lineStart(t, lo) && (hi === t.length - 1 || t.charAt(hi) === '\n')
  if (isWholeLines && hi + 1 < t.length && lo !== hi + 1) {
    return { anchor: lo, head: lineEnd(t, hi + 1) }
  }
  return { anchor: lineStart(t, s.head), head: lineEnd(t, s.head) }
}

// Sorts the selections and merges the ones that overlap (the merged one keeps the first one's
// direction); the primary follows whichever selection absorbed it
function normalize(sels: Sel[], primary: number): { sels: Sel[]; primary: number } {
  const items = sels.map((sel, i) => ({ sel, isPrimary: i === primary }))
  items.sort((a, b) => bounds(a.sel).lo - bounds(b.sel).lo || bounds(a.sel).hi - bounds(b.sel).hi)
  const merged: typeof items = []
  for (const item of items) {
    const prev = merged[merged.length - 1]
    if (!prev || bounds(item.sel).lo > bounds(prev.sel).hi) {
      merged.push({ ...item })
      continue
    }
    const lo = bounds(prev.sel).lo
    const hi = Math.max(bounds(prev.sel).hi, bounds(item.sel).hi)
    prev.sel = prev.sel.anchor <= prev.sel.head ? { anchor: lo, head: hi } : { anchor: hi, head: lo }
    prev.isPrimary ||= item.isPrimary
  }
  return { sels: merged.map((m) => m.sel), primary: Math.max(0, merged.findIndex((m) => m.isPrimary)) }
}

// Applies edits that come in ascending order (one overlapping the one before is cut short) and
// returns where each selection lands in the new text
function applyEdits(t: string, edits: Edit[]): { text: string; sels: Sel[] } {
  let text = ''
  let at = 0
  const sels: Sel[] = []
  for (const e of edits) {
    const start = Math.max(e.start, at)
    text += t.slice(at, start)
    const origin = text.length
    text += e.insert
    at = Math.max(e.end, start)
    sels.push({ anchor: origin + e.anchorRel, head: origin + e.headRel })
  }
  return { text: text + t.slice(at), sels }
}

// The lines of `region` joined: each line break and the blanks after it become one space, or
// nothing before a blank line or the end (`after` is the character that follows the region)
function joinLines(region: string, after: string): string {
  let out = ''
  for (let i = 0; i < region.length; i++) {
    if (region.charAt(i) !== '\n') {
      out += region.charAt(i)
      continue
    }
    let j = i + 1
    while (isBlank(region.charAt(j))) j++
    const next = j < region.length ? region.charAt(j) : after
    out += next === '\n' || next === '' ? '' : ' '
    i = j - 1
  }
  return out
}

// Every non-empty line of `region` indented by one level, or outdented by up to one
function shiftLines(region: string, isIndent: boolean): string {
  return region
    .split('\n')
    .map((line) => {
      if (isIndent) return line === '' ? line : INDENT + line
      return line.startsWith('\t') ? line.slice(1) : line.replace(/^ {1,2}/, '')
    })
    .join('\n')
}

// The same column one line down, or undefined on the last line
function lineBelow(t: string, i: number): number | undefined {
  const nl = t.indexOf('\n', i)
  if (nl === -1) return undefined
  const start = nl + 1
  const next = t.indexOf('\n', start)
  const last = (next === -1 ? t.length : next) - 1
  return clamp(start + i - lineStart(t, i), start, Math.max(start, last))
}


export const register: Register = (on) => {
  let mode: Mode = 'insert'
  let sels: Sel[] = [caret(0)]
  let primary = 0
  // What `y`, `d` and `c` took, one entry per selection
  let yanked: string[] = []
  let pending: Pending = ''
  // Digits typed so far, the repeat count for the next motion (0 when none)
  let count = 0
  // Drafts to return to with `u`, and the ones `u` stepped back from, for `U`
  const past: Box[] = []
  const future: Box[] = []
  let shown: string | undefined

  const label = () => (sels.length > 1 ? `-- ${mode.toUpperCase()} (${sels.length}) --` : STATUS[mode])
  // Whether the status line needs a new text
  const hasNewLabel = () => {
    const next = label()
    if (next === shown) return false
    shown = next
    return true
  }

  const view = (b: Box) => ({
    text: b.text,
    cursor: b.cursor,
    decorations:
      mode === 'insert' || b.text === ''
        ? []
        : b.sels.map((s, i) => ({ start: bounds(s).lo, end: bounds(s).hi + 1, ...(i === b.primary ? PRIMARY : SECONDARY) })),
  })

  // Sorts and merges the selections; outside insert mode they stay on characters of the draft
  const commit = (text: string, next: Sel[], nextPrimary: number, to?: Mode): Out => {
    const top = Math.max(text.length - 1, 0)
    const isInserting = (to ?? mode) === 'insert'
    const placed = isInserting ? next : next.map((s) => ({ anchor: clamp(s.anchor, 0, top), head: clamp(s.head, 0, top) }))
    const merged = normalize(placed, nextPrimary)
    const cursor = (merged.sels[merged.primary] ?? caret(0)).head
    return { text, cursor, sels: merged.sels, primary: merged.primary, to }
  }

  // Pops snapshots off `from` until one differs from the draft (entering insert and leaving
  // it unchanged leaves a duplicate), parking the draft on `to`
  const travel = (from: Box[], to: Box[], current: Box): Box | undefined => {
    for (let snap = from.pop(); snap; snap = from.pop()) {
      if (snap.text === current.text) continue
      to.push(current)
      return snap
    }
    return undefined
  }

  // Applies one normal/select-mode key to every selection of the draft
  const command = (key: string, text: string): Out => {
    const isExtending = mode === 'select'
    const last = Math.max(text.length - 1, 0)
    const keep = () => commit(text, sels, primary)
    const each = (fn: (s: Sel) => Sel, to?: Mode) => commit(text, sels.map(fn), primary, to)
    const main = sels[primary] ?? caret(0)
    const moveTo = (s: Sel, head: number): Sel => (isExtending ? { anchor: s.anchor, head } : caret(head))

    const waiting = pending
    pending = ''
    const given = count
    if (waiting === '' && /^[0-9]$/.test(key) && (key !== '0' || given > 0)) {
      count = given * 10 + Number(key)
      return keep()
    }
    // The count rides through a prefix key (`3gg`, `2fx`) and is spent by the key that completes it
    if (waiting !== '' || !'gmftFTsr'.includes(key) || key === '') count = 0
    const n = Math.max(given, 1)

    const vertically = (head: number, dir: 1 | -1) =>
      Array.from({ length: n }).reduce<number>((h) => vertical(text, h, dir), head)

    // Runs a word motion `n` times: the selection spans from the first word's start to the last's end
    const sweep = (s: Sel, step: (t: string, from: number) => Sel): Sel => {
      let first: Sel | undefined
      let at = s.head
      for (let k = 0; k < n; k++) {
        const w = step(text, at)
        first ??= w
        if (w.head === at) break
        at = w.head
      }
      return { anchor: isExtending ? s.anchor : (first ?? caret(at)).anchor, head: at }
    }

    // Every occurrence of `ch` inside the selections becomes a selection of its own
    const selectIn = (ch: string): Out => {
      const found: Sel[] = []
      let first = -1
      sels.forEach((s, i) => {
        const { lo, hi } = bounds(s)
        for (let at = text.indexOf(ch, lo); ch !== '' && at !== -1 && at <= hi; at = text.indexOf(ch, at + 1)) {
          if (i === primary && first === -1) first = found.length
          found.push(caret(at))
        }
      })
      return found.length === 0 ? keep() : commit(text, found, Math.max(first, 0))
    }

    // Replaces the text around every selection (by default the selection itself) with `fn` of it;
    // each selection then spans the new text
    const rewrite = (fn: (region: string, after: string) => string, span?: (lo: number, hi: number) => number[]): Out => {
      const done = applyEdits(
        text,
        sels.map((s) => {
          const { lo, hi } = bounds(s)
          const [start = lo, end = hi + 1] = span ? span(lo, hi) : [lo, hi + 1]
          const insert = fn(text.slice(start, end), text.charAt(end))
          const tail = Math.max(insert.length - 1, 0)
          const isForward = s.anchor <= s.head
          return { start, end, insert, anchorRel: isForward ? 0 : tail, headRel: isForward ? tail : 0 }
        }),
      )
      return commit(done.text, done.sels, primary)
    }
    const afterBlanks = (i: number) => {
      let end = i
      while (isBlank(text.charAt(end))) end++
      return end
    }

    if (waiting !== '' && key !== 'escape') {
      if (waiting === 'g') {
        switch (key) {
          case 'g': {
            // With a count, `gg` goes to that line
            let at = 0
            for (let k = 1; k < given && text.indexOf('\n', at) !== -1; k++) at = text.indexOf('\n', at) + 1
            return each((s) => moveTo(s, Math.min(at, last)))
          }
          case 'e':
            return each((s) => moveTo(s, last))
          case 'h':
            return each((s) => moveTo(s, lineStart(text, s.head)))
          case 'l':
            return each((s) => moveTo(s, lineLast(text, s.head)))
          default:
            return keep()
        }
      }
      if (waiting === 'm') {
        if (key === 'i' || key === 'a') {
          pending = key === 'i' ? 'mi' : 'ma'
          return keep()
        }
        if (key !== 'm') return keep()
        return each((s) => {
          const at = matchBracket(text, s.head)
          return at === -1 ? s : moveTo(s, at)
        })
      }
      if (waiting === 'mi' || waiting === 'ma') {
        return each((s) => textObject(text, s.head, key, waiting === 'ma') ?? s)
      }
      if (waiting === 's') return key.length === 1 ? selectIn(key) : keep()
      if (waiting === 'r') {
        return key.length === 1 ? rewrite((region) => Array.from(region, (c) => (c === '\n' ? c : key)).join('')) : keep()
      }
      if (key.length !== 1) return keep()
      return each((s) => {
        const at = findChar(text, s.head, key, waiting, n)
        return at === -1 ? s : { anchor: isExtending ? s.anchor : s.head, head: at }
      })
    }

    switch (key) {
      case 'h':
      case 'left':
        return each((s) => moveTo(s, clamp(s.head - n, 0, last)))
      case 'l':
      case 'right':
        return each((s) => moveTo(s, clamp(s.head + n, 0, last)))
      case 'j':
      case 'down':
        return each((s) => moveTo(s, vertically(s.head, 1)))
      case 'k':
      case 'up':
        return each((s) => moveTo(s, vertically(s.head, -1)))
      case '0':
        return each((s) => moveTo(s, lineStart(text, s.head)))
      case '$':
        return each((s) => moveTo(s, lineLast(text, s.head)))
      case 'w':
        return each((s) => sweep(s, nextWord))
      case 'e':
        return each((s) => sweep(s, wordEnd))
      case 'b':
        return each((s) => sweep(s, prevWord))
      case 'g':
      case 'm':
      case 'f':
      case 't':
      case 'F':
      case 'T':
      case 's':
      case 'r':
        pending = key
        return keep()
      case '~':
        return rewrite((region) => Array.from(region, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''))
      case 'J':
        return rewrite(joinLines, (lo, hi) => {
          if (text.slice(lo, hi + 1).includes('\n')) return [lo, text.charAt(hi) === '\n' ? afterBlanks(hi + 1) : hi + 1]
          // A selection inside one line joins that line to the next
          const nl = text.indexOf('\n', hi)
          return [lo, nl === -1 ? hi + 1 : afterBlanks(nl + 1)]
        })
      case '>':
      case '<':
        return rewrite(
          (region) => shiftLines(region, key === '>'),
          (lo, hi) => {
            const nl = text.indexOf('\n', hi)
            return [lineStart(text, lo), nl === -1 ? text.length : nl]
          },
        )
      case '*':
        return each((s) => textObject(text, s.head, 'w', false) ?? s)
      case '%':
        return commit(text, [{ anchor: 0, head: last }], 0)
      case 'x':
        return each((s) => Array.from({ length: n }).reduce<Sel>((acc) => selectLine(text, acc), s))
      case 'v':
        return { ...keep(), to: isExtending ? 'normal' : 'select' }
      case ';':
        return each((s) => caret(s.head))
      case ',':
        return commit(text, [main], 0)
      case '(':
      case ')':
        return commit(text, sels, (primary + sels.length + (key === ')' ? 1 : -1)) % sels.length)
      case 'C': {
        // Copies the selections on the bottom line one line down, `n` times
        let list = sels
        let newPrimary = primary
        for (let k = 0; k < n; k++) {
          const tail = list[list.length - 1]
          if (!tail) break
          const bottom = lineStart(text, bounds(tail).hi)
          const copies: Sel[] = []
          for (const s of list) {
            if (lineStart(text, bounds(s).hi) !== bottom) continue
            const anchor = lineBelow(text, s.anchor)
            const head = lineBelow(text, s.head)
            if (anchor !== undefined && head !== undefined) copies.push({ anchor, head })
          }
          if (copies.length === 0) break
          list = [...list, ...copies]
          newPrimary = list.length - 1
        }
        return commit(text, list, newPrimary)
      }
      case 'escape':
        return each((s) => caret(s.head), 'normal')
      case 'y':
        yanked = sels.map((s) => text.slice(bounds(s).lo, bounds(s).hi + 1))
        return each((s) => caret(s.head), 'normal')
      case 'd':
      case 'c': {
        yanked = sels.map((s) => text.slice(bounds(s).lo, bounds(s).hi + 1))
        const cut = applyEdits(
          text,
          sels.map((s) => ({ start: bounds(s).lo, end: bounds(s).hi + 1, insert: '', anchorRel: 0, headRel: 0 })),
        )
        return commit(cut.text, cut.sels, primary, key === 'c' ? 'insert' : 'normal')
      }
      case 'p': {
        if (yanked.length === 0) return keep()
        const pasted = applyEdits(
          text,
          sels.map((s, i) => {
            // With fewer yanks than selections the last one repeats
            const insert = yanked[i] ?? yanked[yanked.length - 1] ?? ''
            const at = bounds(s).hi + 1
            return { start: at, end: at, insert, anchorRel: 0, headRel: Math.max(insert.length - 1, 0) }
          }),
        )
        return commit(pasted.text, pasted.sels, primary, 'normal')
      }
      case 'o': {
        const opened = applyEdits(
          text,
          sels.map((s) => {
            const end = lineEnd(text, bounds(s).hi)
            const at = text.charAt(end) === '\n' ? end : text.length
            return { start: at, end: at, insert: '\n', anchorRel: 1, headRel: 1 }
          }),
        )
        return commit(opened.text, opened.sels, primary, 'insert')
      }
      case 'O': {
        const opened = applyEdits(
          text,
          sels.map((s) => {
            const at = lineStart(text, bounds(s).lo)
            return { start: at, end: at, insert: '\n', anchorRel: 0, headRel: 0 }
          }),
        )
        return commit(opened.text, opened.sels, primary, 'insert')
      }
      case 'i':
        return each((s) => caret(bounds(s).lo), 'insert')
      case 'a':
        return each((s) => caret(bounds(s).hi + 1), 'insert')
      case 'u':
      case 'U': {
        const [from, to] = key === 'u' ? [past, future] : [future, past]
        let current: Box = { text, cursor: main.head, sels, primary }
        for (let k = 0; k < n; k++) {
          const snap = travel(from, to, current)
          if (!snap) break
          current = snap
        }
        return current
      }
      default:
        return keep()
    }
  }

  on('prompt.edit', async ($, e, next) => {
    const raw = e.key?.key ?? ''

    if (mode === 'insert') {
      // Escape may never reach this hook, so "jk" typed in a row leaves insert mode
      const isJk = raw === 'k' && e.inputText === 'k' && e.text.charAt(e.start - 1) === 'j' && !e.key?.ctrl
      // A cursor moved by something this mod did not see ends the multi-cursor edit
      if (sels.length > 1 && (sels[primary] ?? caret(0)).head !== e.cursor) {
        sels = [caret(e.cursor)]
        primary = 0
        if (hasNewLabel()) $.ui.status(label())
      }

      if (sels.length === 1) {
        if (!isJk) return next(e)

        const text = e.text.slice(0, e.start - 1) + e.text.slice(e.start)
        const head = clamp(e.start - 2, 0, text.length - 1)
        sels = [caret(head)]
        primary = 0
        mode = 'normal'
        if (hasNewLabel()) $.ui.status(label())
        return view({ text, cursor: head, sels, primary })
      }

      // Several cursors: the edit the editor reports for the main one is made at every cursor
      const carets = sels.map((s) => s.head)
      let edits: Edit[]
      if (isJk) {
        edits = carets.map((c) => {
          const at = e.text.charAt(c - 1) === 'j' ? c - 1 : c
          return { start: at, end: c, insert: '', anchorRel: 0, headRel: 0 }
        })
      } else if (e.inputText === '' && e.start === e.end) {
        const delta = e.start - e.cursor
        const moved = normalize(carets.map((c) => caret(clamp(c + delta, 0, e.text.length))), primary)
        sels = moved.sels
        primary = moved.primary
        if (hasNewLabel()) $.ui.status(label())
        return view({ text: e.text, cursor: (sels[primary] ?? caret(0)).head, sels, primary })
      } else {
        const typed = e.inputText.length
        edits = carets.map((c) => ({
          start: clamp(c + e.start - e.cursor, 0, e.text.length),
          end: clamp(c + e.end - e.cursor, 0, e.text.length),
          insert: e.inputText,
          anchorRel: typed,
          headRel: typed,
        }))
      }
      const edited = applyEdits(e.text, edits)
      if (isJk) {
        mode = 'normal'
        const top = Math.max(edited.text.length - 1, 0)
        const normal = normalize(edited.sels.map((s) => caret(clamp(s.head - 1, 0, top))), primary)
        sels = normal.sels
        primary = normal.primary
      } else {
        sels = edited.sels
      }
      if (hasNewLabel()) $.ui.status(label())
      return view({ text: edited.text, cursor: (sels[primary] ?? caret(0)).head, sels, primary })
    }

    // Normal and select mode consume every key; unknown ones leave the draft untouched
    const text = e.text
    const key = e.key?.ctrl || e.key?.meta ? '' : e.key?.shift && raw.length === 1 ? raw.toUpperCase() : raw
    const top = Math.max(text.length - 1, 0)
    sels = sels.map((s) => ({ anchor: clamp(s.anchor, 0, top), head: clamp(s.head, 0, top) }))
    primary = clamp(primary, 0, sels.length - 1)
    const before: Box = { text, cursor: (sels[primary] ?? caret(0)).head, sels, primary }
    const isTravel = pending === '' && (key === 'u' || key === 'U')
    const out = command(key, text)

    // An edit, or entering insert (whose typing follows), is one step back for `u`
    if (!isTravel && (out.text !== text || out.to === 'insert')) {
      past.push(before)
      future.length = 0
      if (past.length > HISTORY_LIMIT) past.shift()
    }

    sels = out.sels
    primary = out.primary
    if (out.to) mode = out.to
    if (hasNewLabel()) $.ui.status(label())
    return view(out)
  })

  on('prompt.submit', ($, e, next) => {
    past.length = 0
    future.length = 0
    sels = [caret(0)]
    primary = 0
    mode = 'insert'
    if (hasNewLabel()) $.ui.status(label())
    return next(e)
  })
}
