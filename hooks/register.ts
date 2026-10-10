import type { Register } from 'claude-code'

type Mode = 'insert' | 'normal' | 'select'
type Sel = { anchor: number; head: number }
type Box = { text: string; cursor: number; sel: Sel }

const SELECTION = { backgroundColor: 'blue' } as const
const STATUS: Record<Mode, string | undefined> = {
  insert: undefined,
  normal: '-- NORMAL --',
  select: '-- SELECT --',
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const isSpace = (c: string) => /\s/.test(c)
const isWord = (c: string) => /[\p{L}\p{M}\p{N}_]/u.test(c)

const lineStart = (t: string, i: number) => t.lastIndexOf('\n', i - 1) + 1
// Index of the line's newline (inclusive end of the line), or the last char
const lineEnd = (t: string, i: number) => {
  const n = t.indexOf('\n', i)
  return n === -1 ? t.length - 1 : n
}

const bounds = (s: Sel) => ({ lo: Math.min(s.anchor, s.head), hi: Math.max(s.anchor, s.head) })
const caret = (head: number): Sel => ({ anchor: head, head })

function nextWord(t: string, from: number): Sel {
  let i = from + 1
  while (i < t.length && isSpace(t[i])) i++
  if (i >= t.length) return caret(t.length - 1)
  const start = i
  while (i + 1 < t.length && !isSpace(t[i + 1]) && isWord(t[i + 1]) === isWord(t[start])) i++
  return { anchor: start, head: i }
}

function prevWord(t: string, from: number): Sel {
  // Mid-word, the character under the cursor belongs to the selection
  const isInsideWord = from > 0 && !isSpace(t[from]) && isWord(t[from - 1]) === isWord(t[from]) && !isSpace(t[from - 1])
  let i = from - 1
  while (i >= 0 && isSpace(t[i])) i--
  if (i < 0) return caret(0)
  const end = isInsideWord ? from : i
  while (i - 1 >= 0 && !isSpace(t[i - 1]) && isWord(t[i - 1]) === isWord(t[end])) i--
  return { anchor: end, head: i }
}

function vertical(t: string, head: number, dir: 1 | -1): number {
  const col = head - lineStart(t, head)
  let start: number
  if (dir === 1) {
    const end = lineEnd(t, head)
    if (t[end] !== '\n') return head
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
  const isWholeLines = lo === lineStart(t, lo) && (hi === t.length - 1 || t[hi] === '\n')
  if (isWholeLines && hi + 1 < t.length && lo !== hi + 1) {
    return { anchor: lo, head: lineEnd(t, hi + 1) }
  }
  return { anchor: lineStart(t, s.head), head: lineEnd(t, s.head) }
}

export const register: Register = (on) => {
  let mode: Mode = 'insert'
  let sel: Sel = caret(0)
  let yanked = ''

  const view = (b: Box) => ({
    text: b.text,
    cursor: b.cursor,
    decorations:
      mode === 'insert' || b.text === ''
        ? []
        : [{ start: bounds(b.sel).lo, end: bounds(b.sel).hi + 1, ...SELECTION }],
  })

  // Applies one normal/select-mode key to the draft; returns the new draft
  const command = (key: string, text: string): Box & { to?: Mode } => {
    const isExtending = mode === 'select'
    const move = (target: Sel, head = target.head): Sel =>
      isExtending ? { anchor: sel.anchor, head } : target
    const keep = (s: Sel): Box => ({ text, cursor: s.head, sel: s })
    const { lo, hi } = bounds(sel)

    switch (key) {
      case 'h':
      case 'left':
        return keep(move(caret(clamp(sel.head - 1, 0, text.length - 1))))
      case 'l':
      case 'right':
        return keep(move(caret(clamp(sel.head + 1, 0, text.length - 1))))
      case 'j':
      case 'down':
        return keep(move(caret(vertical(text, sel.head, 1))))
      case 'k':
      case 'up':
        return keep(move(caret(vertical(text, sel.head, -1))))
      case '0':
        return keep(move(caret(lineStart(text, sel.head))))
      case '$': {
        const end = lineEnd(text, sel.head)
        return keep(move(caret(text[end] === '\n' && end > 0 ? end - 1 : end)))
      }
      case 'w': {
        const w = nextWord(text, sel.head)
        return keep(isExtending ? { anchor: sel.anchor, head: w.head } : w)
      }
      case 'b': {
        const w = prevWord(text, sel.head)
        return keep(isExtending ? { anchor: sel.anchor, head: w.head } : w)
      }
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
      case 'i':
        return { ...keep(sel), cursor: lo, to: 'insert' }
      case 'a':
        return { ...keep(sel), cursor: hi + 1, to: 'insert' }
      default:
        return keep(sel)
    }
  }

  on('prompt.edit', async ($, e, next) => {
    const key = e.key?.key

    if (mode === 'insert') {
      // Escape may never reach this hook, so "jk" typed in a row leaves insert mode
      const isJk = key === 'k' && e.inputText === 'k' && e.text[e.start - 1] === 'j' && !e.key?.ctrl
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
    sel = { anchor: clamp(sel.anchor, 0, text.length - 1), head: clamp(sel.head, 0, text.length - 1) }
    const out = command(e.key?.ctrl || e.key?.meta ? '' : (key ?? ''), text)
    sel = out.sel
    if (out.to) {
      mode = out.to
      $.ui.status(STATUS[out.to])
    }
    return view(out)
  })

  on('prompt.submit', ($, e, next) => {
    if (mode !== 'insert') {
      mode = 'insert'
      $.ui.status(STATUS.insert)
    }
    return next(e)
  })
}
