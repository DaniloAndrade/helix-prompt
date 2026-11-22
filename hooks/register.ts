import type { Register } from 'claude-code'

type Mode = 'insert' | 'normal' | 'select'
type Sel = { anchor: number; head: number }
type Box = { text: string; cursor: number; sel: Sel }
// A key that waits for the next one: `g` goto, `m` match, `f`/`t`/`F`/`T` find a character
type Pending = '' | 'g' | 'm' | 'f' | 't' | 'F' | 'T'

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

// Index of the bracket pairing the one at `at`, or -1
function matchBracket(t: string, at: number): number {
  const open = t.charAt(at)
  const close = PAIRS.get(open)
  if (close === undefined) return -1
  const dir = OPENERS.includes(open) ? 1 : -1
  let depth = 0
  for (let i = at; i >= 0 && i < t.length; i += dir) {
    if (t.charAt(i) === open) depth++
    else if (t.charAt(i) === close && --depth === 0) return i
  }
  return -1
}

// Index `f`/`t`/`F`/`T` lands on for `ch`, searching from `from`, or -1
function findChar(t: string, from: number, ch: string, kind: 'f' | 't' | 'F' | 'T'): number {
  if (kind === 'f' || kind === 't') {
    const i = t.indexOf(ch, from + 1)
    return i === -1 || kind === 'f' ? i : i - 1
  }
  const i = from === 0 ? -1 : t.lastIndexOf(ch, from - 1)
  return i === -1 || kind === 'F' ? i : i + 1
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
  const travel = (from: Box[], to: Box[], text: string): Box | undefined => {
    for (let snap = from.pop(); snap; snap = from.pop()) {
      if (snap.text === text) continue
      to.push({ text, cursor: sel.head, sel })
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
    if (waiting !== '' && key !== 'escape') {
      if (waiting === 'g') {
        switch (key) {
          case 'g':
            return keep(move(caret(0)))
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
        const at = key === 'm' ? matchBracket(text, sel.head) : -1
        return keep(at === -1 ? sel : move(caret(at)))
      }
      const at = key.length === 1 ? findChar(text, sel.head, key, waiting) : -1
      if (at === -1) return keep(sel)
      return keep({ anchor: isExtending ? sel.anchor : sel.head, head: at })
    }

    switch (key) {
      case 'h':
      case 'left':
        return keep(move(caret(clamp(sel.head - 1, 0, last))))
      case 'l':
      case 'right':
        return keep(move(caret(clamp(sel.head + 1, 0, last))))
      case 'j':
      case 'down':
        return keep(move(caret(vertical(text, sel.head, 1))))
      case 'k':
      case 'up':
        return keep(move(caret(vertical(text, sel.head, -1))))
      case '0':
        return keep(move(caret(lineStart(text, sel.head))))
      case '$':
        return keep(move(caret(lineLast(text, sel.head))))
      case 'w': {
        const w = nextWord(text, sel.head)
        return keep(isExtending ? { anchor: sel.anchor, head: w.head } : w)
      }
      case 'e': {
        const w = wordEnd(text, sel.head)
        return keep(isExtending ? { anchor: sel.anchor, head: w.head } : w)
      }
      case 'b': {
        const w = prevWord(text, sel.head)
        return keep(isExtending ? { anchor: sel.anchor, head: w.head } : w)
      }
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
        return keep(selectLine(text, sel))
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
        const snap = key === 'u' ? travel(past, future, text) : travel(future, past, text)
        return snap ? { ...snap, cursor: snap.sel.head } : keep(sel)
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
