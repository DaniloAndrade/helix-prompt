import type { Register } from 'claude-code'

type Mode = 'insert' | 'normal' | 'select'
type Sel = { anchor: number; head: number }
type Box = { text: string; cursor: number; sel: Sel }
// A key that waits for the next one: `g` goto, `m` match (`mi`/`ma` then pick a text object),
// `f`/`t`/`F`/`T` find a character
type Pending = '' | 'g' | 'm' | 'mi' | 'ma' | 'f' | 't' | 'F' | 'T'

const SELECTION = { backgroundColor: 'blue' } as const
const STATUS: Record<Mode, string | undefined> = {
  insert: undefined,
  normal: '-- NORMAL --',
  select: '-- SELECT --',
}
const HISTORY_LIMIT = 100
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

function nextWord(t: string, from: number): Sel {
  let i = from + 1
  while (i < t.length && isSpace(t.charAt(i))) i++
  if (i >= t.length) return caret(t.length - 1)
  const start = i
  while (i + 1 < t.length && !isSpace(t.charAt(i + 1)) && isWord(t.charAt(i + 1)) === isWord(t.charAt(start))) i++
  return { anchor: start, head: i }
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

function prevWord(t: string, from: number): Sel {
  // Mid-word, the character under the cursor belongs to the selection
  const isInsideWord = from > 0 && !isSpace(t.charAt(from)) && isWord(t.charAt(from - 1)) === isWord(t.charAt(from)) && !isSpace(t.charAt(from - 1))
  let i = from - 1
  while (i >= 0 && isSpace(t.charAt(i))) i--
  if (i < 0) return caret(0)
  const end = isInsideWord ? from : i
  while (i - 1 >= 0 && !isSpace(t.charAt(i - 1)) && isWord(t.charAt(i - 1)) === isWord(t.charAt(end))) i--
  return { anchor: end, head: i }
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

const isBlank = (c: string) => c === ' ' || c === '\t'

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

export const register: Register = (on) => {
  let mode: Mode = 'insert'
  let sel: Sel = caret(0)
  let yanked = ''
  let pending: Pending = ''
  // Digits typed so far, the repeat count for the next motion (0 when none)
  let count = 0
  // Drafts to return to with `u`, and the ones `u` stepped back from, for `U`
  const past: Box[] = []
  const future: Box[] = []

  const view = (b: Box) => ({
    text: b.text,
    cursor: b.cursor,
    decorations:
      mode === 'insert' || b.text === ''
        ? []
        : [{ start: bounds(b.sel).lo, end: bounds(b.sel).hi + 1, ...SELECTION }],
  })

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

  // Applies one normal/select-mode key to the draft; returns the new draft
  const command = (key: string, text: string): Box & { to?: Mode } => {
    const isExtending = mode === 'select'
    const move = (target: Sel, head = target.head): Sel =>
      isExtending ? { anchor: sel.anchor, head } : target
    const keep = (s: Sel): Box => ({ text, cursor: s.head, sel: s })
    const { lo, hi } = bounds(sel)
    const last = Math.max(text.length - 1, 0)

    const waiting = pending
    pending = ''
    const given = count
    if (waiting === '' && /^[0-9]$/.test(key) && (key !== '0' || given > 0)) {
      count = given * 10 + Number(key)
      return keep(sel)
    }
    // The count rides through a prefix key (`3gg`, `2fx`) and is spent by the key that completes it
    if (waiting !== '' || !'gmftFT'.includes(key) || key === '') count = 0
    const n = Math.max(given, 1)

    // Runs a word motion `n` times: the selection spans from the first word's start to the last's end
    const sweep = (step: (t: string, from: number) => Sel): Sel => {
      let first: Sel | undefined
      let at = sel.head
      for (let k = 0; k < n; k++) {
        const w = step(text, at)
        first ??= w
        if (w.head === at) break
        at = w.head
      }
      return { anchor: isExtending ? sel.anchor : (first ?? caret(at)).anchor, head: at }
    }

    if (waiting !== '' && key !== 'escape') {
      if (waiting === 'g') {
        switch (key) {
          case 'g': {
            // With a count, `gg` goes to that line
            let at = 0
            for (let k = 1; k < given && text.indexOf('\n', at) !== -1; k++) at = text.indexOf('\n', at) + 1
            return keep(move(caret(Math.min(at, last))))
          }
          case 'e':
            return keep(move(caret(last)))
          case 'h':
            return keep(move(caret(lineStart(text, sel.head))))
          case 'l':
            return keep(move(caret(lineLast(text, sel.head))))
          default:
            return keep(sel)
        }
      }
      if (waiting === 'm') {
        if (key === 'i' || key === 'a') {
          pending = key === 'i' ? 'mi' : 'ma'
          return keep(sel)
        }
        const at = key === 'm' ? matchBracket(text, sel.head) : -1
        return keep(at === -1 ? sel : move(caret(at)))
      }
      if (waiting === 'mi' || waiting === 'ma') {
        return keep(textObject(text, sel.head, key, waiting === 'ma') ?? sel)
      }
      const at = key.length === 1 ? findChar(text, sel.head, key, waiting, n) : -1
      if (at === -1) return keep(sel)
      return keep({ anchor: isExtending ? sel.anchor : sel.head, head: at })
    }

    switch (key) {
      case 'h':
      case 'left':
        return keep(move(caret(clamp(sel.head - n, 0, last))))
      case 'l':
      case 'right':
        return keep(move(caret(clamp(sel.head + n, 0, last))))
      case 'j':
      case 'down':
        return keep(move(caret(Array.from({ length: n }).reduce<number>((h) => vertical(text, h, 1), sel.head))))
      case 'k':
      case 'up':
        return keep(move(caret(Array.from({ length: n }).reduce<number>((h) => vertical(text, h, -1), sel.head))))
      case '0':
        return keep(move(caret(lineStart(text, sel.head))))
      case '$':
        return keep(move(caret(lineLast(text, sel.head))))
      case 'w':
        return keep(sweep(nextWord))
      case 'e':
        return keep(sweep(wordEnd))
      case 'b':
        return keep(sweep(prevWord))
      case 'g':
      case 'm':
      case 'f':
      case 't':
      case 'F':
      case 'T':
        pending = key
        return keep(sel)
      case '%':
        return keep({ anchor: 0, head: last })
      case 'x':
        return keep(Array.from({ length: n }).reduce<Sel>((s) => selectLine(text, s), sel))
      case 'v':
        return { ...keep(sel), to: isExtending ? 'normal' : 'select' }
      case 'escape':
        return { ...keep(caret(sel.head)), to: 'normal' }
      case 'y':
        yanked = text.slice(lo, hi + 1)
        return { ...keep(caret(sel.head)), to: 'normal' }
      case 'd':
      case 'c': {
        yanked = text.slice(lo, hi + 1)
        const rest = text.slice(0, lo) + text.slice(hi + 1)
        const head = clamp(lo, 0, rest.length - 1)
        return { text: rest, cursor: lo, sel: caret(head), to: key === 'c' ? 'insert' : 'normal' }
      }
      case 'p': {
        if (yanked === '') return keep(sel)
        const next = text.slice(0, hi + 1) + yanked + text.slice(hi + 1)
        const pasted = { anchor: hi + 1, head: hi + yanked.length }
        return { text: next, cursor: pasted.head, sel: pasted, to: 'normal' }
      }
      case 'o': {
        const end = lineEnd(text, hi)
        const at = text.charAt(end) === '\n' ? end : text.length
        return { text: text.slice(0, at) + '\n' + text.slice(at), cursor: at + 1, sel: caret(at + 1), to: 'insert' }
      }
      case 'O': {
        const at = lineStart(text, lo)
        return { text: text.slice(0, at) + '\n' + text.slice(at), cursor: at, sel: caret(at), to: 'insert' }
      }
      case 'i':
        return { ...keep(sel), cursor: lo, to: 'insert' }
      case 'a':
        return { ...keep(sel), cursor: hi + 1, to: 'insert' }
      case 'u':
      case 'U': {
        const [from, to] = key === 'u' ? [past, future] : [future, past]
        let current: Box = { text, cursor: sel.head, sel }
        for (let k = 0; k < n; k++) {
          const snap = travel(from, to, current)
          if (!snap) break
          current = { ...snap, cursor: snap.sel.head }
        }
        return current
      }
      default:
        return keep(sel)
    }
  }

  on('prompt.edit', async ($, e, next) => {
    const raw = e.key?.key ?? ''

    if (mode === 'insert') {
      // Escape may never reach this hook, so "jk" typed in a row leaves insert mode
      const isJk = raw === 'k' && e.inputText === 'k' && e.text.charAt(e.start - 1) === 'j' && !e.key?.ctrl
      if (!isJk) return next(e)

      const text = e.text.slice(0, e.start - 1) + e.text.slice(e.start)
      const head = clamp(e.start - 2, 0, text.length - 1)
      sel = caret(head)
      mode = 'normal'
      $.ui.status(STATUS.normal)
      return view({ text, cursor: head, sel })
    }

    // Normal and select mode consume every key; unknown ones leave the draft untouched
    const text = e.text
    const key = e.key?.ctrl || e.key?.meta ? '' : e.key?.shift && raw.length === 1 ? raw.toUpperCase() : raw
    sel = { anchor: clamp(sel.anchor, 0, text.length - 1), head: clamp(sel.head, 0, text.length - 1) }
    const before: Box = { text, cursor: sel.head, sel }
    const isTravel = pending === '' && (key === 'u' || key === 'U')
    const out = command(key, text)

    // An edit, or entering insert (whose typing follows), is one step back for `u`
    if (!isTravel && (out.text !== text || out.to === 'insert')) {
      past.push(before)
      future.length = 0
      if (past.length > HISTORY_LIMIT) past.shift()
    }

    sel = out.sel
    if (out.to) {
      mode = out.to
      $.ui.status(STATUS[out.to])
    }
    return view(out)
  })

  on('prompt.submit', ($, e, next) => {
    past.length = 0
    future.length = 0
    if (mode !== 'insert') {
      mode = 'insert'
      $.ui.status(STATUS.insert)
    }
    return next(e)
  })
}
