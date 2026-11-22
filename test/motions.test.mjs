import { session, eq, done } from './drive.mjs'

const fresh = async (text) => { const s = session(); await s.type(text); await s.type('jk'); await s.press('0'); return s }
// gg to reach the start regardless of newlines
const home = async (s) => { await s.press('g'); await s.press('g') }

{ const s = await fresh('hello world foo'); eq('jk enters normal', s.status, '-- NORMAL --'); eq('jk text', s.text, 'hello world foo') }
{ const s = await fresh('hello world foo'); await s.press('e'); eq('e from start', s.sel(), 'hello'); await s.press('e'); eq('e again', s.sel(), 'world') }
{ const s = await fresh('hello world foo'); await s.press('w'); eq('w from word start takes the word and its blank', s.sel(), 'hello '); await s.press('w'); eq('w', s.sel(), 'world '); await s.press('w'); eq('w last word', s.sel(), 'foo') }
{ const s = await fresh('hello world foo'); await s.press('w'); await s.press('w'); await s.press('b'); eq('b from a trailing blank takes the word and the blank before it', s.sel(), ' world') }
{ const s = await fresh('ação coração café'); await s.press('e'); eq('e unicode', s.sel(), 'ação') }
{ const s = await fresh('one\ntwo\nthree'); await s.press('g'); await s.press('e'); eq('ge', s.cursor, 12); await home(s); eq('gg', s.cursor, 0) }
{ const s = await fresh('one\ntwo\nthree'); await home(s); await s.press('j'); await s.press('g'); await s.press('l'); eq('gl', s.cursor, 6); await s.press('g'); await s.press('h'); eq('gh', s.cursor, 4) }
{ const s = await fresh('a=b; c=d'); await s.press('f'); await s.press(';'); eq('f;', s.sel(), 'a=b;'); }
{ const s = await fresh('a=b; c=d'); await s.press('t'); await s.press(';'); eq('t;', s.sel(), 'a=b') }
{ const s = await fresh('a=b; c=d'); await s.press('$'); await s.press('F'.toLowerCase(), { shift: true }); await s.press(';'); eq('F;', s.sel(), '; c=d') }
{ const s = await fresh('a=b; c=d'); await s.press('$'); await s.press('t', { shift: true }); await s.press(';'); eq('T;', s.sel(), ' c=d') }
{ const s = await fresh('f(a(b))'); await s.press('f'); await s.press('x'); eq('f missing char is no-op', s.cursor, 0) }
{ const s = await fresh('f(a(b))'); await s.press('l'); await s.press('m'); await s.press('m'); eq('mm open', s.cursor, 6); await s.press('m'); await s.press('m'); eq('mm close', s.cursor, 1) }
{ const s = await fresh('one\ntwo'); await home(s); await s.press('o'); await s.type('X'); eq('o', s.text, 'one\nX\ntwo'); eq('o status', s.status, undefined) }
{ const s = await fresh('one\ntwo'); await s.press('j'); await s.press('o'); await s.type('X'); eq('o on last line', s.text, 'one\ntwo\nX') }
{ const s = await fresh('one\ntwo'); await s.press('j'); await s.press('O', { shift: true }); await s.type('X'); eq('O', s.text, 'one\nX\ntwo') }
{ const s = await fresh('one two'); await s.press('%', { shift: true }); eq('% select all', s.sel(), 'one two') }
{ const s = await fresh('one two three'); await s.press('w'); await s.press('w'); await s.press('d'); eq('d', s.text, 'one three'); await s.press('u'); eq('u undoes d', s.text, 'one two three'); await s.press('U', { shift: true }); eq('U redoes', s.text, 'one three'); await s.press('u'); await s.press('u'); eq('u at start is no-op', s.text, 'one two three') }
{ const s = await fresh('one two'); await s.press('w'); await s.press('w'); await s.press('c'); await s.type('XYZ'); eq('c typing', s.text, 'one XYZ'); await s.type('jk'); await s.press('u'); eq('u undoes c plus typing', s.text, 'one two') }
{ const s = await fresh('one two'); await s.press('i'); await s.type('jk'); await s.press('w'); await s.press('d'); await s.press('u'); eq('empty i/jk skipped by u', s.text, 'one two') }
{ const s = await fresh('abc'); await s.press('x'); await s.press('d'); eq('x d', s.text, ''); await s.press('u'); eq('u after delete all', s.text, 'abc') }
{ const s = await fresh('one two'); await s.press('w'); await s.press('w'); await s.press('d'); await s.submit(); await s.type('jk'); await s.press('u'); eq('history cleared on submit', s.text, 'one ') }
{ const s = await fresh('one two'); await s.press('g'); await s.press('escape'); await s.press('l'); eq('escape cancels pending', s.cursor, 1) }
{ const s = await fresh('one two'); await s.press('v'); await s.press('f'); await s.press('t'); eq('select-mode f extends', s.sel(), 'one t') }

const at = async (text, col) => { const s = await fresh(text); await home(s); for (let i = 0; i < col; i++) await s.press('l'); return s }
const obj = async (s, kind, ch) => { await s.press('m'); await s.press(kind); await s.press(ch, ch !== ch.toLowerCase() ? { shift: true } : {}) }

// text objects
{ const s = await at('hello world', 1); await obj(s, 'i', 'w'); eq('miw', s.sel(), 'hello') }
{ const s = await at('hello world', 1); await obj(s, 'a', 'w'); eq('maw trailing space', s.sel(), 'hello ') }
{ const s = await at('hello world', 8); await obj(s, 'a', 'w'); eq('maw leading space', s.sel(), ' world') }
{ const s = await at('a.b c', 0); await obj(s, 'i', 'W'); eq('miW', s.sel(), 'a.b') }
{ const s = await at('a.b c', 0); await obj(s, 'i', 'w'); eq('miw punctuation splits', s.sel(), 'a') }
{ const s = await at('ação café', 1); await obj(s, 'i', 'w'); eq('miw unicode', s.sel(), 'ação') }
{ const s = await at('f(a, (b), c)', 2); await obj(s, 'i', '('); eq('mi(', s.sel(), 'a, (b), c') }
{ const s = await at('f(a, (b), c)', 2); await obj(s, 'a', ')'); eq('ma)', s.sel(), '(a, (b), c)') }
{ const s = await at('f(a, (b), c)', 6); await obj(s, 'i', 'b'); eq('mib nested', s.sel(), 'b') }
{ const s = await at('f(a, (b), c)', 1); await obj(s, 'i', '('); eq('mi( on the opener', s.sel(), 'a, (b), c') }
{ const s = await at('f(a, (b), c)', 11); await obj(s, 'i', '('); eq('mi( on the closer', s.sel(), 'a, (b), c') }
{ const s = await at('()', 0); await obj(s, 'i', '('); eq('mi( empty is no-op', s.cursor, 0) }
{ const s = await at('x f', 0); await obj(s, 'i', '('); eq('mi( without pair is no-op', s.cursor, 0) }
{ const s = await at('{ a }', 2); await obj(s, 'i', 'B'); eq('miB', s.sel(), ' a ') }
{ const s = await at('a<b>c', 2); await obj(s, 'i', '<'); eq('mi<', s.sel(), 'b') }
{ const s = await at('[1, 2]', 1); await obj(s, 'a', '['); eq('ma[', s.sel(), '[1, 2]') }
{ const s = await at('say "hello world" now', 6); await obj(s, 'i', '"'); eq('mi"', s.sel(), 'hello world') }
{ const s = await at('say "hello world" now', 6); await obj(s, 'a', '"'); eq('ma"', s.sel(), '"hello world"') }
{ const s = await at("it's 'ok' fine", 7); await obj(s, 'i', "'"); eq("mi' leaves an unpaired quote alone", s.cursor, 7) }
{ const s = await at('a "b" c "d"', 9); await obj(s, 'i', '"'); eq('mi" second pair', s.sel(), 'd') }
{ const s = await at('one\ntwo\n\nthree', 5); await obj(s, 'i', 'p'); eq('mip', s.sel(), 'one\ntwo') }
{ const s = await at('one\ntwo\n\nthree', 5); await obj(s, 'a', 'p'); eq('map', s.sel(), 'one\ntwo\n\n') }
{ const s = await at('one\ntwo\n\nthree', 9); await obj(s, 'i', 'p'); eq('mip last paragraph', s.sel(), 'three') }
{ const s = await at('one\ntwo', 1); await obj(s, 'i', 'p'); await s.press('d'); eq('mip then d', s.text, '') }
{ const s = await at('foo(bar)', 5); await obj(s, 'i', '('); await s.press('c'); await s.type('X'); eq('mi( then c', s.text, 'foo(X)') }
{ const s = await at('foo(bar)', 5); await obj(s, 'i', '('); await s.press('u'); eq('text object leaves no undo step', s.text, 'foo(bar)') }
{ const s = await at('a b', 0); await s.press('m'); await s.press('i'); await s.press('escape'); await s.press('l'); eq('escape cancels mi', s.cursor, 1) }
{ const s = await at('f(a)', 2); await s.press('v'); await obj(s, 'i', '('); eq('select mode replaces with object', s.sel(), 'a') }

// counts
{ const s = await at('a b c d e', 0); await s.type('3w'); eq('3w', s.sel(), 'a b c ') }
{ const s = await at('a b c d e', 0); await s.type('3e'); eq('3e', s.sel(), 'b c d') }
{ const s = await at('a b c d e', 8); await s.type('2b'); eq('2b', s.sel(), ' d e') }
{ const s = await at('abcdefgh', 0); await s.type('3l'); eq('3l', s.cursor, 3) }
{ const s = await at('abcdefgh', 6); await s.type('4h'); eq('4h', s.cursor, 2) }
{ const s = await at('abcdefgh', 0); await s.type('10l'); eq('10l clamps', s.cursor, 7) }
{ const s = await at('abcdefgh', 3); await s.type('0'); eq('0 alone is line start', s.cursor, 0) }
{ const s = await at('a\nb\nc\nd', 0); await s.type('2j'); eq('2j', s.cursor, 4); await s.type('5k'); eq('5k stops at top', s.cursor, 0) }
{ const s = await at('axbxc', 0); await s.type('2fx'); eq('2fx', s.sel(), 'axbx') }
{ const s = await at('axbxc', 0); await s.type('2tx'); eq('2tx', s.sel(), 'axb') }
{ const s = await at('axbxcx', 5); await s.type('2Fx'); eq('2Fx', s.sel(), 'xbxcx') }
{ const s = await at('axbxc', 0); await s.type('3fx'); eq('3fx missing is no-op', s.cursor, 0) }
{ const s = await at('one\ntwo\nthree', 0); await s.type('2x'); eq('2x', s.sel(), 'one\ntwo\n') }
{ const s = await at('one\ntwo\nthree', 0); await s.type('2gg'); eq('2gg goes to line 2', s.cursor, 4) }
{ const s = await at('one\ntwo\nthree', 0); await s.type('9gg'); eq('9gg clamps to the last line', s.cursor, 8) }
{ const s = await at('one\ntwo\nthree', 0); await s.type('1gg'); eq('1gg', s.cursor, 0) }
{ const s = await at('abcdefgh', 0); await s.type('3'); await s.press('escape'); await s.press('l'); eq('escape drops the count', s.cursor, 1) }
{ const s = await at('abcdefgh', 0); await s.type('3'); await s.press('d'); await s.press('l'); eq('count is spent by any key', s.cursor, 1) }
{ const s = await fresh('one two three'); await s.press('w'); await s.press('w'); await s.press('d'); await s.press('w'); await s.press('w'); await s.press('d'); await s.type('2u'); eq('2u', s.text, 'one two three') }
{ const s = await fresh('one two three'); await s.press('w'); await s.press('w'); await s.press('d'); await s.press('w'); await s.press('w'); await s.press('d'); const edited = s.text; await s.type('2u'); await s.type('2'); await s.press('U', { shift: true }); eq('2U', s.text, edited) }
{ const s = await at('abcdefgh', 0); await s.press('v'); await s.type('3l'); eq('3l extends in select mode', s.sel(), 'abcd') }

// w, Helix semantics
{ const s = await at('hello world foo', 2); await s.press('w'); eq('w mid-word starts at the cursor', s.sel(), 'llo ') }
{ const s = await at('hello world foo', 4); await s.press('w'); eq('w from the last letter selects the blanks', s.sel(), ' '); await s.press('w'); eq('then the next word', s.sel(), 'world ') }
{ const s = await at('hello   world', 0); await s.press('w'); eq('w bridges a long blank', s.sel(), 'hello   ') }
{ const s = await at('foo.bar baz', 0); await s.press('w'); eq('w stops at punctuation', s.sel(), 'foo'); await s.press('w'); eq('w punctuation run', s.sel(), '.'); await s.press('w'); eq('w after punctuation', s.sel(), 'bar ') }
{ const s = await at('a b c', 0); await s.press('w'); eq('w on a one-letter word', s.sel(), 'a ') }
{ const s = await at('foo\nbar', 0); await s.press('w'); eq('w stops before a newline', s.sel(), 'foo'); await s.press('w'); eq('w newline', s.sel(), '\n'); await s.press('w'); eq('w next line', s.sel(), 'bar') }
{ const s = await at('ação café', 0); await s.press('w'); eq('w unicode', s.sel(), 'ação ') }
{ const s = await at('hello world foo', 0); await s.press('v'); await s.press('w'); eq('select mode w extends through the blank', s.sel(), 'hello ') ; await s.press('w'); eq('select mode w again', s.sel(), 'hello world ') }
{ const s = await at('one two three', 0); await s.press('w'); await s.press('d'); eq('w then d takes the blank too', s.text, 'two three') }
{ const s = await at('one two three', 0); await s.type('2w'); eq('2w', s.sel(), 'one two ') }

// b, mirror of w
{ const s = await at('one two three', 12); await s.press('b'); eq('b from the last letter takes the leading blank', s.sel(), ' three'); await s.press('b'); eq('b again', s.sel(), ' two'); await s.press('b'); eq('b first word has no blank', s.sel(), 'one') }
{ const s = await at('one two three', 10); await s.press('b'); eq('b mid-word starts at the cursor', s.sel(), ' thr') }
{ const s = await at('one two three', 8); await s.press('b'); eq('b from a word start selects the blanks', s.sel(), ' '); await s.press('b'); eq('then the previous word', s.sel(), ' two') }
{ const s = await at('hello   world', 12); await s.press('b'); eq('b bridges a long blank', s.sel(), '   world') }
{ const s = await at('foo.bar', 6); await s.press('b'); eq('b mid-word punctuation', s.sel(), 'bar'); await s.press('b'); eq('b punctuation run', s.sel(), '.'); await s.press('b'); eq('b before punctuation', s.sel(), 'foo') }
{ const s = await at('a b c', 4); await s.press('b'); eq('b on a one-letter word', s.sel(), ' c') }
{ const s = await at('foo\nbar', 6); await s.press('b'); eq('b stops after a newline', s.sel(), 'bar'); await s.press('b'); eq('b newline', s.sel(), '\n'); await s.press('b'); eq('b previous line', s.sel(), 'foo') }
{ const s = await at('ação café', 8); await s.press('b'); eq('b unicode', s.sel(), ' café') }
{ const s = await at('one two three', 0); await s.press('b'); eq('b at the start stays', s.cursor, 0) }
{ const s = await at('one two three', 12); await s.press('v'); await s.press('b'); await s.press('b'); eq('select mode b extends back', s.sel(), ' two three') }
{ const s = await at('one two three', 12); await s.press('b'); await s.press('d'); eq('b then d takes the blank too', s.text, 'one two') }
{ const s = await at('one two three', 12); await s.type('2b'); eq('2b words', s.sel(), ' two three') }


