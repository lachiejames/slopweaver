# `memory check` — every finding id, and what each cannot see

`MEMORY_CHECK_IDS` in `src/memory/types.ts` is the registry and its order is the report's order: the rules
true of one file first, then the graph, then the placement rules that read routing. A test proves each id
FIRES on a corpus that breaks it and stays quiet on the clean one, and a second test fails when an id is
missing from this page.

| Id                          | Fires on                                                                                      | Module          |
| --------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| `schema`                    | frontmatter missing, duplicated, mistyped, or a malformed `metadata.slopweaver` block         | `parse.ts`      |
| `name-format`               | a `name` outside the kebab identity grammar, or carrying a redundant type prefix              | `nameFormat.ts` |
| `dated-addendum`            | a paragraph whose lead-in names an amendment word before a date (`Settled 29 Sep 2001:`)      | `addendum.ts`   |
| `missing-root-index`        | no `MEMORY.md` — the directory is not a corpus, and nothing else is reported                  | `check.ts`      |
| `orphan`                    | a leaf no index routes                                                                        | `check.ts`      |
| `dead-pointer`              | an index link to a file that does not exist, inside the corpus or out                         | `check.ts`      |
| `double-routed`             | a leaf routed from more than one index                                                        | `check.ts`      |
| `collision`                 | two leaves claiming one identity, by filename or `name`                                       | `check.ts`      |
| `unreachable`               | a leaf routed only from a topic index `MEMORY.md` does not link                               | `check.ts`      |
| `dangling-wikilink`         | a `[[link]]` matching no memory                                                               | `check.ts`      |
| `superseded-still-present`  | a memory answering `supersedes` for another memory that is still on disk                      | `check.ts`      |
| `why-always-loaded-missing` | a leaf `MEMORY.md` routes whose body does not open with `**Why always-loaded:**`              | `placement.ts`  |
| `index-line-drift`          | a `MEMORY.md` line naming a date, turn id, `#n` or proper name its memory does not carry      | `indexDrift.ts` |
| `amends-canon-without-row`  | a declared `amendsCanon` naming no row, a row the board lacks, or one done or closed unlanded | `placement.ts`  |

## What each new rule cannot see, stated rather than discovered

- **`dated-addendum`** reads a paragraph's OPENER only — its leading bold span, or its first eight words. An
  amendment in the middle of a paragraph (`… Since 28 Sep 2001 the step is …`) and a dated lead-in with no
  amendment word (`**Routing, 29 Sep 2001:**`) are not seen; tests pin both as silent. An amendment verb must
  come before the date, which is what keeps `**The owner's words, 7 Aug 2001:**` quiet. In a label the verb must OPEN
  a phrase — the label's first word (an opening bracket or quote allowed), or the first after a comma,
  semicolon, colon or dash (`--` included) — so `**The owner's correction, 5 Aug 2001**`
  and `**Slack's rate-limit update, 29 May 2001**` stay quiet; a shouted verb may continue a shouted phrase — trailing words with no
  lowercase and two capitals between them (`SCOPE CHANGED`, `OPTION C CONFIRMED`, `SCOPE (CHANGED`). A shouted verb inside one word
  (`AUTO-UPDATED`, `CREATED/UPDATED`) never fires, in a label or in prose; one behind a glued `--` starts its own. The date must follow the verb directly (a comma, colon or dash allowed: `Updated: 3 Sep 2001`), or within three words behind a comma or parenthesis
  (`Superseded in part, 25 Aug 2001`), never through a bare preposition (`changed on 3 Sep 2001`). A word is whatever
  sits between spaces short of a comma or parenthesis, so `rule-10`, `owner's` and `v2.1` are one word each.
  Plain prose fires only on a capitalised verb, the date hung off it the same way (`CORRECTED: 2001-07-28`), or an opening `As of <date>` /
  `Since <date>`, an opening bracket or quote allowed. Of ordinals, only `Second` and `Third` opening a label are
  read (`Second data point, 20 Aug 2001`). A heading's leading bold span is read whole, however long. Measured on
  a backup of the live corpus, the report misses 7 of 42 genuine hits (35 left): three from the prose rule, four named in
  `addendum.ts` (`**The owner's correction (2001-08-11)**` among them). The lead-in is read from micromark's
  RENDERED text and quoted through the date with whitespace collapsed, so no edit that renders identically — a
  rewrap, `__` for `**`, a hard break, a character reference, a code span's delimiters — and no edit after the
  date changes `memory gate`'s key. A code span counts as one word, never a verb or a date. A link's destination and title and an image's alt text are never read, and
  inline HTML reads as the escaped text it renders as. An HTML BLOCK is never read — including a `<div>` line
  that interrupts a tight list item and renders as its next line.
- **`dated-addendum` is reported, never refused at write time.** Eight review passes each found a sound memory
  in whichever shape a write was refused on, the narrowest included — `- **Narrowed 9 Sep 2001** back to 15`
  records a pool's history, not an edit to the memory — and across 1789 live memory directories that shape
  refused one write. A false report costs one `memory gate --accept`; a false refusal stops a writer mid-turn.
- **`why-always-loaded-missing`** judges only root-routed leaves: a topic-routed memory does not load at boot.
- **`index-line-drift`** compares identifiers only. Numbers and code spans were measured out — across twelve
  corpora they fired 40 times with no true positive, every one a spelled-out count or an abbreviated command.
  A paraphrase that reverses meaning without changing an identifier is a reading task. Topic indexes are not
  judged. A turn id needs a three-digit prefix, so `10-15 rows` is a range, and a weekday or month is never a
  name. Each missing identifier is its own finding, so a partial repair never re-reports the rest as new.
  Nothing measured has tripped it yet.
- **`amends-canon-without-row`** needs the board: a verb resolves each declared row through
  `src/cli/commands/memory/judgedCorpus.ts`, which loads the board reader only when a leaf declares one. A
  caller that skips it sees every row `unresolved` and only the "names no row" half fires. A row that is never
  settled keeps its memory alive; that is the row's owner's to close, not this check's. A `filed` ask is
  followed to the row it became, but an `answered` one reads `done`, so name the row that LANDS the change,
  never the ask the ruling came from — the delete message says to confirm the target first. The hygiene pass
  carries it as `adjust` even when the message says delete ([hygiene](hygiene.md)).

## Declaring a memory that amends canon

A memory that bridges sessions until a canon edit lands names the board row landing it, and is deleted once
that row settles ([placement](../../knowledge/reference/placement.md)). Declare it so `check` can tell you when:

```yaml
metadata:
  slopweaver:
    amendsCanon: { target: AGENTS.md, row: <board-slug> }
```

`amends-canon-without-row` fires when `row` is absent, names no board doc, or names one that is `done`
(delete the memory) or cancelled (the amendment is void). A `filed` ask is followed to the row it became.

## What is refused at write time

Only `name-format` and the never-resolvable wikilink are refused at WRITE time: every graph and placement rule
has a legitimate half-written window mid-save, the amends rule needs I/O a `PreToolUse` hook does not do, and
`dated-addendum` reads prose too loosely to refuse on.
