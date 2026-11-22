# helix-prompt

Helix-style modal editing for the [Claude Code](https://code.claude.com) prompt box: select first, act after.

Built as a Claude Code mod on the `prompt.edit` hook. Early prototype.

## Install

```
/plugin install helix-prompt --marketplace DaniloAndrade/helix-prompt
```

Turn off the built-in vim mode (`/config` → Editor mode) so the two don't compete for keys.

## Usage

The prompt starts in **insert** mode. Type `jk` to enter **normal** mode (`Esc` also works if the terminal delivers it). Sending the prompt returns to insert. The mode shows in the status line, and the selection is highlighted.

| Key | Action |
| --- | --- |
| `h` `j` `k` `l`, arrows | move |
| `0` `$` | line start / end |
| `w` `b` | select the next word with its trailing blanks / the previous word with its leading blanks |
| `e` | select to the end of the word |
| `gg` `ge` | start / end of the text |
| `gh` `gl` | line start / end |
| `f`/`t` + char | select to / till the next char; `F`/`T` search backwards |
| `mm` | jump to the matching `()` `[]` `{}` |
| `mi` / `ma` + object | select inside / around: `w` word, `W` WORD, `(` `)` `b`, `[` `]`, `{` `}` `B`, `<` `>`, `"` `'` `` ` ``, `p` paragraph |
| `x` | select line (repeat to extend) |
| `%` | select everything |
| `v` | toggle select mode (motions extend the selection) |
| `d` `c` `y` | delete / change / yank the selection |
| `p` | paste after the selection |
| `i` `a` | insert before / after the selection |
| `o` `O` | open a line below / above and insert |
| `u` `U` | undo / redo (an insert session is one step) |
| `r` + char | replace every selected character with the char |
| `~` | swap the case of the selection |
| `J` | join the selected lines (or this line with the next) |
| `>` `<` | indent / outdent the selected lines |
| `*` | select the word under the cursor |
| `s` + char | select every occurrence of the char inside the selections |
| `C` | copy the selection to the next line (repeat or `3C` for more lines) |
| `;` `,` | collapse the selections to cursors / keep only the primary one |
| `(` `)` | make the previous / next selection the primary one |

With several selections every motion and edit applies to all of them, `i` `a` `c` `o` `O` type at every cursor, and the status line shows how many there are. The primary selection is blue, the others cyan. Selections that overlap merge.

A number before a motion repeats it: `3w` selects three words, `2fx` finds the second `x`, `4j` moves four lines down, `2x` selects two lines, `2gg` goes to line 2, `2u` undoes two steps. `Esc` drops a pending count or prefix.

Unknown keys in normal mode are ignored.

## Limitations

- Multi-selection is built with `s` (one literal character, no regex) and `C`; there is no `S` split and no way to drop just the primary selection.
- Several cursors typing: Backspace past the text typed in the same session reaches the neighbouring cursor's text.
- Counts apply to motions, `x`, `gg` and `u`/`U`; `d`, `c`, `y`, `p`, `o` ignore them.
- Undo history lives in the mod and resets when the prompt is submitted.
- Words are Unicode-aware (`ação` is one word); surrogate pairs (emoji) are not handled.
- Mod API is early access and may change between Claude Code releases.

## Development

```sh
make test      # behaviour tests: they drive the hooks the way the editor does (Node 22.18+)
make check     # type-check against the engine's declarations
make validate  # claude plugin validate
```

Run it from the repo while editing with `claude --plugin-dir .`. Bump `version` in `.claude-plugin/plugin.json` on each behaviour change, or `/plugin update` will not notice it.

## License

MIT
