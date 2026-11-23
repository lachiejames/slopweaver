# The ruling register

The owner's standing rulings, by category, in the owner's own words. The verb is `slopweaver ruling`
([skill](../skills/ruling/SKILL.md)); the code is `src/ruling/`.

## Why it exists

A ruling the owner gives is reviewed when a new word of the owner's concretely conflicts with it, never on a clock.
That needs two things the supervisor state document's `### RULINGS` rows could not give: every current ruling on a
topic in one place, and the earlier ruling shown beside a new word that touches it. Rows scattered across boot
blocks and archive files gave neither.

## Where it lives, and what never leaves the machine

`$SLOPWEAVER_HOME/rulings.jsonl`, mode `0600`, written only by `ruling record` and `ruling seed`, both under the
home's operation lock. The words are the owner's, so nothing of the register is committed: tests and examples use
synthetic words. It is not an authored-home file (`src/store/fleet/authoredDirectories.ts`), so the fleet import never
copies it into the store. `ruling view` does write one derived page into the LOCAL store, served by the console;
that page then sits wherever that local store's own backups go.

## One row

| Field         | Holds                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| `id`          | `ruling-` and twelve hex digits                                                   |
| `category`    | a kebab slug; the set of categories is whatever the rows use                      |
| `words`       | the owner's words, never trimmed, reflowed or reworded                            |
| `anchor`      | where the words were said, when known                                             |
| `context`     | what the source said about the occasion beside the anchor (`on page …, call two`) |
| `decidedOn`   | the day it was decided, `YYYY-MM-DD`                                              |
| `replaces`    | the ids of the rulings it replaced                                                |
| `recordedIso` | when the row was written                                                          |
| `origin`      | `record`, or `seed` with its seed key and the file and line it was read from      |

A ruling is **current** exactly when no later row names it in `replaces`. A row may replace only a ruling current
when it is written, so each is replaced at most once. The file is append-only: a change of mind is a new row, and the
old words survive under it. A file that will not read, a line that will not parse, or rows that contradict each
other are refused, never repaired; only a missing file is empty. An append that fails part way is cut back to the
bytes the file held before it, so a refusal leaves no partial row; a process killed mid-write can still leave one,
and the next read refuses it.

## How a conflict surfaces

No model runs in the CLI (AGENTS.md rule 2), so the register does not judge a conflict. It refuses to file a ruling
while a current ruling in the same category stands beside it undisposed, and prints that ruling in full beside the
new words. The recording session reads both and says, per earlier ruling, `--replaces <id>` or `--alongside`. The
stated limit: same-category is a candidate test, so a wrong category hides a real conflict, and a broad category
shows rulings that do not conflict.

## How it relates to the other things called rulings

- **`handover rule`** records the owner's word about ONE board row, as an event on that row's journal; it can gate
  verbs and opens a finding's doors ([ruling gates](../skills/handover/reference/ruling-gates.md)). It stays there.
  When a row ruling turns out to be standing precedent, record it here too, with the same anchor.
- **`general-rulings.json`** is the Slack tag decision tree's own rulings about which asks the bot answers
  (`src/live/turn/generalRulings.ts`). It is a config the bot reads, not this register.

All three are the owner's rulings; they differ in scope, which is why they sit apart.

## Seeding

`ruling seed --plan` reads each named document's `### RULINGS` sections (`src/ruling/sourceRows.ts` holds the row
grammar) and prints each ruling with its id and seed key, the rows skipped by name (`STEER`, `ASKED`, filler) and the
rows it could not read with certainty. `--decisions <file> --apply` files every ruling under its decision (category,
replaces, alongside), oldest first, through the same checks `record` runs, and refuses the whole batch while a
blocker stands or a ruling has no decision.

The seed key is a digest of the date, anchor, context and words, never the file or line, so a block folded into an
archive stays the same ruling and a re-run files nothing twice. The same ruling copied into a later block collapses
to one; so would a ruling genuinely given twice in identical words on one day, which is the price of that property.
The words are the row's own characters from the first `: ` after its locator to the end of its last indented
continuation line, line breaks and indentation kept; a `\r` before a newline is a line ending. An indented list
item inside a row is a blocker rather than a continuation, since it may be a ruling of its own, and so is an indented
paragraph after a blank line, which may be part of the row's words. The source documents are read before the
register's lock is taken, so a slow one never holds the lock past its lease; only the register is read under it.
