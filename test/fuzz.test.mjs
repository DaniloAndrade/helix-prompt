// Randomised checks with a fixed seed: the motions always make progress, and typing at several
// cursors equals typing the same keys at each position by hand
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { session } from './drive.mjs'

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (rand, items) => items[Math.floor(rand() * items.length)]
const randomText = (rand, alphabet, max) => Array.from({ length: 1 + Math.floor(rand() * max) }, () => pick(rand, alphabet)).join('')

const walk = async (key, text, setup) => {
  const s = session()
  await s.type(text)
  await s.type('jk')
  await setup(s)
  let previous = -1
  for (let steps = 0; steps <= text.length + 2; steps++) {
    await s.press(key)
    if (s.cursor === previous) return { stopped: true, s }
    previous = s.cursor
  }
  return { stopped: false, s }
}

const alphabet = ['a', 'b', ' ', ' ', '.', '\n', 'ç']

test('w always reaches the end of the text', async () => {
  const rand = rng(1)
  for (let n = 0; n < 300; n++) {
    const text = randomText(rand, alphabet, 14)
    if (text.includes('jk')) continue
    const { stopped } = await walk('w', text, async (s) => { await s.press('g'); await s.press('g') })
    assert.ok(stopped, `w kept moving on ${JSON.stringify(text)}`)
  }
})

test('b always reaches the start of the text', async () => {
  const rand = rng(2)
  for (let n = 0; n < 300; n++) {
    const text = randomText(rand, alphabet, 14)
    if (text.includes('jk')) continue
    const { stopped, s } = await walk('b', text, async (s) => { await s.press('g'); await s.press('e') })
    assert.ok(stopped, `b kept moving on ${JSON.stringify(text)}`)
    assert.equal(s.cursor, 0, `b stopped short on ${JSON.stringify(text)}`)
  }
})

test('typing at several cursors equals typing at each one', async () => {
  const rand = rng(3)
  const letters = ['a', 'b', ',', ' ', 'c']
  let checked = 0
  for (let n = 0; n < 300; n++) {
    const text = randomText(rand, letters, 14)
    // Adjacent or leading commas leave cursors that merge or that Backspace would pass
    if (text.includes('jk') || text.includes(',,') || text.startsWith(',') || !text.includes(',')) continue
    const typed = Array.from({ length: Math.floor(rand() * 6) }, () => (rand() < 0.25 ? 'backspace' : pick(rand, letters.slice(0, 4))))
    // A Backspace that eats more than was typed reaches the neighbour's text
    let balance = 0
    if (typed.some((k) => (balance += k === 'backspace' ? -1 : 1) < 0)) continue

    const s = session()
    await s.type(text)
    await s.type('jk')
    await s.press('g'); await s.press('g')
    await s.press('%', { shift: true }); await s.press('s'); await s.press(',')
    await s.press('c')
    for (const k of typed) await s.press(k)

    let expected = text
    for (const at of [...text].flatMap((c, i) => (c === ',' ? [i] : [])).reverse()) {
      let left = expected.slice(0, at)
      for (const k of typed) left = k === 'backspace' ? left.slice(0, -1) : left + k
      expected = left + expected.slice(at + 1)
    }
    assert.equal(s.text, expected, `${JSON.stringify(text)} typed ${JSON.stringify(typed)}`)
    checked++
  }
  assert.ok(checked > 50, 'the generator skipped too many cases')
})
