// Drives the mod's hooks the way the editor does, with the real register() in a fresh closure per session.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from '../hooks/register.ts'

export function session() {
  // Each session gets its own register() call: the mod's state lives in that closure
  const hooks = {}
  register((name, fn) => { hooks[name] = fn })
  let status
  const $ = { ui: { status: (s) => { status = s } } }
  let text = '', cursor = 0, last
  const press = async (key, mods = {}) => {
    // What the editor reports in insert mode: typing splices at the cursor, Backspace takes the character before it, an arrow lands one over
    const span = key === 'backspace' ? [cursor - 1, cursor] : key === 'left' ? [cursor - 1, cursor - 1] : key === 'right' ? [cursor + 1, cursor + 1] : [cursor, cursor]
    const e = { origin: { kind: 'composer' }, key: { key, ...mods }, text, cursor, start: span[0], end: span[1], inputText: key.length === 1 ? key : '' }
    const r = await hooks['prompt.edit']($, e, async (x) => ({
      text: x.text.slice(0, x.start) + x.inputText + x.text.slice(x.end), cursor: x.start + x.inputText.length,
    }))
    text = r.text; cursor = r.cursor; last = r
  }
  const type = async (s) => { for (const ch of s) await press(ch, ch !== ch.toLowerCase() ? { shift: true } : {}) }
  const sel = () => { const d = last?.decorations?.[0]; return d ? text.slice(d.start, d.end) : null }
  const all = () => (last?.decorations ?? []).map((d) => text.slice(d.start, d.end))
  const primary = () => { const d = (last?.decorations ?? []).find((x) => x.backgroundColor === 'blue'); return d ? text.slice(d.start, d.end) : null }
  return { press, type, all, primary, get text() { return text }, get cursor() { return cursor }, sel, get status() { return status },
    submit: () => hooks['prompt.submit']($, {}, async (x) => x) }
}

// Registers a test whose subject is already computed: a session helper drives the hook, then eq compares
export const eq = (name, got, want) => test(name, () => assert.deepEqual(got, want))
// Kept so scripts written as sequences of eq calls need no ending
export const done = () => {}
