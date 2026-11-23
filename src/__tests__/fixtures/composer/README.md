# Composer fixtures — a prompt suggestion beside a typed line

Six files, three shapes, one live capture each. They are what `src/cmux/composer.ts` is measured against, and
between them they are the evidence for the whole module: **the plain-text reads are indistinguishable and the
styled grids are not.**

| shape       | `surface.read_text`      | `terminal.replay`  |
| ----------- | ------------------------ | ------------------ |
| typed       | `typed.screen.txt`       | `typed.json`       |
| suggestion  | `suggestion.screen.txt`  | `suggestion.json`  |
| placeholder | `placeholder.screen.txt` | `placeholder.json` |

## How they were captured

MEASURED with cmux 0.64.22, Claude Code 2.1.263, on one scratch cmux workspace opened for the
measurement and closed after it. The `.json` files are the raw `terminal.replay` reply; the `.txt` files are
the `surface.read_text` reply for the same composer, seconds apart.

Claude Code's prompt suggestions were OFF in the owner's own settings when this was measured
(`promptSuggestionEnabled: false`, which the owner set after the incident this closes), so the suggestion capture was
taken with the feature re-enabled for the scratch session only, via
`claude --settings <a file containing {"promptSuggestionEnabled": true}>`. The guard has to hold whether or not
that setting is on today.

Reproduce the shapes on any live session with:

```bash
slopweaver cmux read-screen --workspace <ref> --json     # carries the composer verdict
```

## Redaction

Two mechanical substitutions, and nothing else — the files are otherwise the replies byte for byte:

- every absolute home path became `<HOME>`;
- every cmux UUID became an all-zero UUID.

Never hand-edit one of these. Re-capture instead.
