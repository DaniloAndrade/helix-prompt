import { session, eq, done } from './drive.mjs'
const fresh = async (text) => { const s = session(); await s.type(text); await s.type('jk'); await s.press('g'); await s.press('g'); return s }
const mark = async (s, ch) => { await s.press('%', { shift: true }); await s.press('s'); await s.press(ch) }

{ const s = await fresh('a,b,c'); await mark(s, ','); eq('s selects each occurrence', s.all(), [',', ',']); eq('s status', s.status, '-- NORMAL (2) --') }
{ const s = await fresh('a,b,c'); await mark(s, 'z'); eq('s without a match is a no-op', s.all(), ['a,b,c']) }
{ const s = await fresh('a,b,c'); await s.press('s'); await s.press('escape'); await s.press('l'); eq('escape cancels s', s.cursor, 1) }
{ const s = await fresh('a,b,c'); await mark(s, ','); await s.press('c'); await s.type('X'); eq('c types at every cursor', s.text, 'aXbXc'); eq('insert status counts cursors', s.status, '-- INSERT (2) --'); await s.type('YZ'); eq('more typing', s.text, 'aXYZbXYZc'); await s.press('backspace'); eq('backspace at every cursor', s.text, 'aXYbXYc') }
{ const s = await fresh('a,b,c'); await mark(s, ','); await s.press('c'); await s.type('X'); await s.type('jk'); eq('jk leaves multi insert', s.text, 'aXbXc'); eq('back to normal with both cursors', s.status, '-- NORMAL (2) --'); eq('cursors on the typed chars', s.all(), ['X', 'X']) }
{ const s = await fresh('a,b,c'); await mark(s, ','); await s.press('i'); await s.press('right'); await s.type('X'); eq('arrows move every cursor', s.text, 'a,Xb,Xc') }
{ const s = await fresh('a,b,c'); await mark(s, ','); await s.press('d'); eq('d deletes every selection', s.text, 'abc'); eq('d leaves two cursors', s.status, '-- NORMAL (2) --') }
{ const s = await fresh('a,b,c'); await mark(s, ','); await s.press('d'); await s.press('u'); eq('u undoes a multi delete', s.text, 'a,b,c'); eq('u restores both selections', s.all(), [',', ',']) }
{ const s = await fresh('axbx'); await mark(s, 'x'); await s.press('y'); await s.press('p'); eq('y then p pastes at every selection', s.text, 'axxbxx') }
{ const s = await fresh('axbxc'); await mark(s, 'x'); await s.press('y'); await s.press('d'); eq('d after y', s.text, 'abc'); await s.press('p'); eq('p pastes the yanks per selection', s.text, 'abxcx') }
{ const s = await fresh('one\ntwo'); await s.press('C', { shift: true }); eq('C copies the selection down', s.all(), ['o', 't']); eq('C status', s.status, '-- NORMAL (2) --') }
{ const s = await fresh('ab\ncd\nef'); await s.press('C', { shift: true }); await s.press('C', { shift: true }); eq('C again goes one more line', s.all(), ['a', 'c', 'e']); eq('the last copy is primary', s.primary(), 'e') }
{ const s = await fresh('ab\ncd\nef'); await s.type('2C'); eq('2C', s.all(), ['a', 'c', 'e']) }
{ const s = await fresh('ab\ncd'); await s.press('l'); await s.press('C', { shift: true }); eq('C keeps the column', s.all(), ['b', 'd']) }
{ const s = await fresh('ab\nc'); await s.press('l'); await s.press('C', { shift: true }); eq('C clips to a short line', s.all(), ['b', 'c']) }
{ const s = await fresh('one'); await s.press('C', { shift: true }); eq('C on the last line is a no-op', s.all(), ['o']) }
{ const s = await fresh('ab cd\nef gh'); await s.press('C', { shift: true }); await s.press('w'); eq('w moves every selection', s.all(), ['ab ', 'ef ']) }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('$'); eq('$ moves every selection', s.all(), ['b', 'd']) }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('0'); await s.press('d'); eq('d takes a character per line', s.text, 'b\nd') }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('x'); await s.press('d'); eq('x then d takes whole lines', s.text, '') }
{ const s = await fresh('one\ntwo'); await s.press('C', { shift: true }); await s.press('o'); await s.type('X'); eq('o opens a line under each', s.text, 'one\nX\ntwo\nX') }
{ const s = await fresh('one\ntwo'); await s.press('C', { shift: true }); await s.press('O', { shift: true }); await s.type('X'); eq('O opens a line above each', s.text, 'X\none\nX\ntwo') }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('a'); await s.type('X'); eq('a appends at every selection', s.text, 'aXb\ncXd') }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('i'); await s.type('X'); eq('i inserts at every selection', s.text, 'Xab\nXcd') }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press(','); eq(', keeps only the primary', s.all(), ['c']) }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('x'); await s.press(';'); eq('; collapses to cursors', s.all(), ['\n', 'd']) }
{ const s = await fresh('ab\ncd\nef'); await s.type('2C'); eq('primary is the last', s.primary(), 'e'); await s.press(')'); eq(') rotates forward', s.primary(), 'a'); await s.press('('); eq('( rotates back', s.primary(), 'e'); await s.press('('); eq('( again', s.primary(), 'c') }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('%', { shift: true }); eq('% collapses to one selection', s.all(), ['ab\ncd']) }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('v'); await s.press('l'); eq('select mode extends each', s.all(), ['ab', 'cd']) }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('0'); await s.press('l'); await s.press('0'); eq('overlapping selections merge', s.all(), ['a', 'c']) }
{ const s = await fresh('a b'); await s.press('w'); await s.press('w'); await s.press('b'); await s.press('C', { shift: true }); eq('copy on the last line stays one', s.all().length, 1) }
{ const s = await fresh('f(a)\nf(b)'); await s.press('l'); await s.press('C', { shift: true }); await s.press('m'); await s.press('i'); await s.press('('); eq('mi( on every selection', s.all(), ['a', 'b']) }
{ const s = await fresh('a,b,c'); await mark(s, ','); await s.press('c'); await s.type('X'); await s.press('left'); await s.press('left'); await s.type('Y'); eq('arrows then typing', s.text, 'YaXYbXc') }
{ const s = await fresh('a,b,c'); await mark(s, ','); await s.press('c'); await s.type('X'); await s.submit(); eq('submit drops the extra cursors', s.status, undefined) }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('d'); await s.press('u'); await s.press('U', { shift: true }); eq('U redoes a multi delete', s.text, 'b\nd') }
{ const s = await fresh('ab\ncd'); await s.press('C', { shift: true }); await s.press('c'); await s.type('X'); await s.type('jk'); await s.press('u'); eq('u undoes a multi change in one step', s.text, 'ab\ncd') }

