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
| `w` `e` `b` | select next word / to word end / previous word |
| `gg` `ge` | start / end of the text |
| `gh` `gl` | line start / end |
| `f`/`t` + char | select to / till the next char; `F`/`T` search backwards |
| `mm` | jump to the matching `()` `[]` `{}` |
| `x` | select line (repeat to extend) |
| `%` | select everything |
| `v` | toggle select mode (motions extend the selection) |
| `d` `c` `y` | delete / change / yank the selection |
| `p` | paste after the selection |
| `i` `a` | insert before / after the selection |
| `o` `O` | open a line below / above and insert |
| `u` `U` | undo / redo (an insert session is one step) |

Unknown keys in normal mode are ignored.

## Limitations

- Single selection, no multi-cursor, no counts, no text objects.
- Undo history lives in the mod and resets when the prompt is submitted.
- Words are Unicode-aware (`ação` is one word); surrogate pairs (emoji) are not handled.
- Mod API is early access and may change between Claude Code releases.

## License

MIT
