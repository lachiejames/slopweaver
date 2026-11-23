---
name: ruling
description: Keep the owner's standing rulings by category — each in the owner's own words, with where it was said, the day it was decided and what it replaced — in the state home, never the repository; file a new one beside the earlier rulings it might conflict with, list them by category, seed them from the supervisor state documents' RULINGS sections, and publish the one read-only page. Use when the owner rules on something that should hold beyond one board row, when a new word of the owner's may contradict an earlier ruling, when someone asks what the owner has ruled on a topic, or when the owner wants to read their current rulings. Phrases like "record that ruling", "what was ruled on landing", "does this conflict with an earlier ruling", "show me my rulings", "which rulings are current", "seed the rulings from the state doc".
argument-hint: "record --category <slug> --words <text> --decided-on <YYYY-MM-DD> [--anchor <where>] [--replaces <id>]... [--alongside] [--new-category] | list [--category <slug>] [--all] | seed --from <doc>... (--plan | --decisions <file> --apply) | view"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" ruling $ARGUMENTS` and report the result.

## What this register is, and what it is not

**The owner's rulings live in the STATE home**, `$SLOPWEAVER_HOME/rulings.jsonl`, one per line, append-only, mode
`0600`. The repository holds only the mechanism. Never copy a ruling's words into a commit, a test, a doc, a pull
request or a fixture: a test uses synthetic words.

It is the install-wide register of rulings that hold beyond one piece of work. A board row's own ruling is
`handover rule` and stays on that row's journal ([handover](../handover/SKILL.md)): it is the owner's word about
that row. When a row ruling turns out to be standing precedent, record it here as well, with the same anchor.

## Recording: the earlier ruling is shown beside the new one

```bash
slopweaver ruling record --category <slug> --words "<the owner's words, exactly>" --decided-on <YYYY-MM-DD> \
  --anchor <talk:… | talk-call:…#turn_… | transcript:…> [--context "<the occasion>"]
```

- **The words are the owner's, verbatim.** Never reword, summarise or reflow them; the anchor says where they were said.
- **A category is a kebab slug a ruling already uses.** A new one needs `--new-category`, so a misspelling never
  opens a second category beside the first. `ruling list` shows which exist.
- **While a current ruling in the same category stands, `record` REFUSES and prints it in full beside the new
  words.** Read the two together, then re-run with `--replaces <id>` for each earlier ruling the new one supersedes,
  `--alongside` when the rest do not conflict, or both. Nothing is written on a refusal. This is how a conflict is
  reviewed: on a new word that touches an earlier one, never on a clock.
- A conflict the owner has not resolved is not yours to resolve: ask the owner through the supervisor, quoting both rulings.

Same-category rulings are conflict CANDIDATES. A wrong category hides a real conflict, and a broad one shows
unrelated rulings; the verb judges nothing, the recording session does.

## Reading

```bash
slopweaver ruling list [--category <slug>]   # the current rulings, grouped by category
slopweaver ruling list --all [--json]        # every ruling, each replaced one marked with what replaced it
slopweaver ruling view                       # publish the one read-only page and print its console address
```

`view` republishes the page at slug `ruling` from the register as it stands. It is the register's only page:
never build a second surface for it.

## Seeding from the state documents

Rulings recorded before this register existed sit as rows under `### RULINGS` in
`$SLOPWEAVER_HOME/supervisor/state.md` and its `archive/*.md`. Seed them in two steps:

```bash
slopweaver ruling seed --from <state.md> --from <archive>.md --plan
slopweaver ruling seed --from <state.md> --from <archive>.md --decisions <file.jsonl> --apply
```

`--plan` prints every ruling found with its id and seed key, every row skipped (`STEER`, `ASKED`, filler) and every
row it could not read with certainty; a blocker stops `--apply`. The decisions file, kept in the state home and never
committed, holds one line per seed key:
`{"seedKey":"seed-v1:…","category":"<slug>","replaces":["ruling-…"],"alongside":false}`. Apply files the rulings
oldest first through the same checks `record` uses, and a re-run files nothing it already filed. The words are copied
from the row byte for byte. The full contract: [rulings](../../docs/rulings.md).
