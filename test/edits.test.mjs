import { session, eq } from './drive.mjs'

const fresh = async (text) => { const s = session(); await s.type(text); await s.type('jk'); await s.press('g'); await s.press('g'); return s }
const at = async (text, col) => { const s = await fresh(text); for (let i = 0; i < col; i++) await s.press('l'); return s }
const all = async (s) => s.press('%', { shift: true })
const shifted = (s, key) => s.press(key, { shift: true })

// r
{ const s = await fresh('hello'); await all(s); await s.press('r'); await s.press('x'); eq('r replaces every selected character', s.text, 'xxxxx') }
{ const s = await fresh('ab\ncd'); await all(s); await s.press('r'); await s.press('x'); eq('r keeps the line breaks', s.text, 'xx\nxx') }
{ const s = await at('abc', 1); await s.press('r'); await s.press('Z', { shift: true }); eq('r on a cursor', s.text, 'aZc') }
{ const s = await at('hello world', 0); await s.press('w'); await s.press('r'); await s.press('-'); eq('r after w also takes the blank', s.text, '------world') }
{ const s = await at('hello', 0); await all(s); await s.press('r'); await s.press('x'); eq('r keeps the selection', s.sel(), 'xxxxx') }
{ const s = await at('abc', 0); await s.press('r'); await s.press('escape'); await s.press('l'); eq('escape cancels r', s.cursor, 1); eq('and changes nothing', s.text, 'abc') }
{ const s = await fresh('a,b,c'); await s.press('%', { shift: true }); await s.press('s'); await s.press(','); await s.press('r'); await s.press(';'); eq('r on every selection', s.text, 'a;b;c') }
{ const s = await at('abc', 0); await all(s); await s.press('r'); await s.press('x'); await s.press('u'); eq('u undoes r', s.text, 'abc') }

// ~
{ const s = await fresh('Hello World'); await all(s); await s.press('~', { shift: true }); eq('~ swaps case', s.text, 'hELLO wORLD') }
{ const s = await at('abc', 1); await s.press('~', { shift: true }); eq('~ on a cursor', s.text, 'aBc') }
{ const s = await fresh('ação'); await all(s); await s.press('~', { shift: true }); eq('~ unicode', s.text, 'AÇÃO') }
{ const s = await fresh('straße'); await all(s); await s.press('~', { shift: true }); eq('~ that changes the length keeps the selection', s.sel(), 'STRASSE') }
{ const s = await fresh('Ab'); await all(s); await s.press('~', { shift: true }); await s.press('u'); eq('u undoes ~', s.text, 'Ab') }

// J
{ const s = await fresh('a\nb\nc'); await s.press('J', { shift: true }); eq('J joins the next line', s.text, 'a b\nc') }
{ const s = await fresh('a\n  b\n\nc'); await all(s); await s.press('J', { shift: true }); eq('J trims blanks and drops blank lines', s.text, 'a b c') }
{ const s = await fresh('a\nb\nc'); await s.press('x'); await s.press('J', { shift: true }); eq('J on a selected line', s.text, 'a b\nc') }
{ const s = await at('a\nb', 2); await s.press('J', { shift: true }); eq('J on the last line does nothing', s.text, 'a\nb') }
{ const s = await fresh('a\nb\nc'); await s.press('J', { shift: true }); await s.press('J', { shift: true }); eq('J again', s.text, 'a b c') }
{ const s = await fresh('a\nb'); await s.press('J', { shift: true }); await s.press('u'); eq('u undoes J', s.text, 'a\nb') }

// > and <
{ const s = await fresh('a\nb'); await all(s); await shifted(s, '>'); eq('> indents every line', s.text, '  a\n  b') }
{ const s = await fresh('a\nb'); await shifted(s, '>'); eq('> on a cursor indents its line', s.text, '  a\nb') }
{ const s = await fresh('a\n\nb'); await all(s); await shifted(s, '>'); eq('> leaves blank lines alone', s.text, '  a\n\n  b') }
{ const s = await fresh('  a\n    b'); await all(s); await shifted(s, '<'); eq('< takes one level off', s.text, 'a\n  b') }
{ const s = await fresh('\tx'); await all(s); await shifted(s, '<'); eq('< takes a tab', s.text, 'x') }
{ const s = await fresh(' x'); await all(s); await shifted(s, '<'); eq('< takes what is there', s.text, 'x') }
{ const s = await fresh('x'); await all(s); await shifted(s, '<'); eq('< on an unindented line does nothing', s.text, 'x') }
{ const s = await fresh('a\nb\nc'); await s.press('x'); await shifted(s, '>'); eq('> on a selected line', s.text, '  a\nb\nc') }
{ const s = await fresh('a\nb'); await all(s); await shifted(s, '>'); eq('> keeps the selection', s.sel(), '  a\n  b') }
{ const s = await fresh('a\nb'); await all(s); await shifted(s, '>'); await s.press('u'); eq('u undoes >', s.text, 'a\nb') }
{ const s = await fresh('a\nb'); await s.press('C', { shift: true }); await shifted(s, '>'); eq('> on several selections', s.text, '  a\n  b') }

// *
{ const s = await at('hello world', 8); await s.press('*'); eq('* selects the word', s.sel(), 'world') }
{ const s = await at('hello, world', 5); await s.press('*'); eq('* on punctuation selects the run', s.sel(), ',') }
{ const s = await at('ab cd\nef gh', 0); await s.press('C', { shift: true }); await s.press('*'); eq('* on every selection', s.all(), ['ab', 'ef']) }
