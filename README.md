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
| `w` `b` | select next / previous word |
| `x` | select line (repeat to extend) |
| `v` | toggle select mode (motions extend the selection) |
| `d` `c` `y` | delete / change / yank the selection |
| `p` | paste after the selection |
| `i` `a` | insert before / after the selection |

Unknown keys in normal mode are ignored.

## Limitations

- Single selection, no multi-cursor, no counts, no text objects.
- Words are Unicode-aware (`ação` is one word); surrogate pairs (emoji) are not handled.
- Mod API is early access and may change between Claude Code releases.

## License

MIT
