# Data classes: how far a stored record may travel beyond the owner

Part of [The local Supabase store](../store.md).

The owner ruled the frame: keep and classify everything at intake, discard nothing; rules sort incoming data; an AI
assessment is used for personal material; the classes are Public, Internal, Personal and Restricted, agreed in
principle; and the outbound check reads the actual content. This page is the store's half of that: the classes, the unit they apply to, the column that holds them and
the census of what holds one. The vocabulary and its read rule are `src/store/dataClass.ts`; the census is
`src/store/dataClassCensus.ts`.

## The unit is one stored record

A class belongs to one row: one `content` row, one `owner_capture` row, one `owner_turn` body. The owner's scheme
classes by passage and the store holds no passages, so a record carries the highest class of any passage in it.
Nothing here classes a passage on its own. A source, container,
channel, home folder or register is never classified and never lends a class to what is inside it. Those are facts a
sorting rule may read, so two rows in one channel can carry different classes. A folder-level class would be too loose
for the most private record in the folder or too tight for the rest, and nothing about a record would say which.

## Four classes, and an unknown state that fails closed

| Class        | Means                                                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public`     | may be surfaced beyond the owner (the bot, a session answering someone else), within what the record's own `visibility` already permits. Not outbound clearance: the outbound check is. |
| `internal`   | work material and bulk automated input (newsletters, receipts, automated senders). Not surfaced beyond the owner yet.                                                                   |
| `personal`   | personal material, which an AI assessment classifies. Never surfaced beyond the owner.                                                                                                  |
| `restricted` | the owner's alone. The owner's own sessions may read it; nothing surfaces it to anyone else.                                                                                            |
| `unknown`    | nobody has classified it. Every reader treats it exactly as `restricted`; the value stays distinct so the census can count it.                                                          |

`visibility` (`public` / `private`) stays the source's own access axis. A data class only ever narrows it: a `private`
row is never made readable by a `public` class. `private` is not a class name for that reason.

**Fail-closed is one function.** `effectiveDataClass` reads a row with no stored class as `unknown`, by an explicit
branch, and `reachesBeyondOwner` is true for `public` alone. That is the owner's start-strict ruling: narrow exceptions
are approved one at a time. Widening to `internal` is one reviewed change to `CLASSES_REACHING_BEYOND_OWNER`. A caller
asks `reachesBeyondOwner` rather than comparing names, so a class added later is refused everywhere until that set says
otherwise.

## The column, and why it is nullable

`data_class` is a nullable column of the `data_class` enum on `content`, `owner_capture` and `owner_turn`, with no
default. Every row written before it existed holds `NULL` and reads as `unknown`. The migration adding it is one
`CREATE TYPE` and three `ADD COLUMN`s, additive, so the door catches a store up to it with no hand `store push`. The
migration backfills nothing; `store classify` (below) sorts the rows already stored.

## The census

`slopweaver store share` prints one summary line and `--json` carries every entry: each declared table, each home
register and each classified home path, either `row-classified` (the three tables above) or `unclassified` with its
reason. Tables are declared by name in closed lists, and `src/__tests__/unit/store/dataClassCensus.test.ts` fails when
a table joins the barrel with no decision, or when the schema's `data_class` columns and the census's row-classified
list disagree. Home paths follow from their backup class (`src/store/fleet/authoredDirectories.ts`), which says whether a
path is backed up or imported and is not a data class.

Unclassified fails closed: a consumer treats every row of an unclassified table as `unknown`.

## Rules sort at intake

Every `content` row is written with a class, and `src/store/dataClassRules.ts` decides which. A rule matches a
record's facts by exact value: its table, source, kind, effective visibility, container and author. Every field the
rule names must match, and the first matching rule wins. It ends in one of the four classes, or in `assess`, meaning
personal material that an assessment decides. Bulk automated input (newsletters, receipts, automated senders) is
`internal` by rule, and which senders those are is the installation's to write. A record no rule matches is written
`unknown`. A rule cannot assign `unknown`, so only a gap in the rules produces it.

The installation's own rules come first, from `$SLOPWEAVER_HOME/judgement/data-class-rules.json`, and the defaults in
code come after them:

```json
{
  "version": 1,
  "rules": [{ "id": "install:eng-channel", "match": { "container": ["slack/C0FIXTURE"] }, "action": "public" }]
}
```

The defaults assign no class at all. Private-lane material and the owner's captured speech go to `assess`, and
everything else stays `unknown` until the installation's rules widen it. An absent file means the defaults alone. A
file that exists but cannot be read, is not JSON or is not a valid rule set makes every ingest refuse. It never falls
back to the defaults, because rows written under rules the owner did not mean would be wrongly classified with nothing
to show it. Each handle, channel and author a rule names lives in that file, never in code.

**A row is classed on the container it is stored against.** The run's container ids (`ContainerIds`,
`src/store/ingestIds.ts`) are filled only from the rows the database returns, each under its own source and native
id, so no caller can hand in an id filed under another container's key. A record whose container did not resolve
fails its whole batch, rather than being stored against no container while classed on its own.

**The assessment is a port, types only.** `DataClassAssessment` is the shape a future assessment fills: the record's
facts and text in, a class with its reason (or `undecided`) out. It has no implementation and no caller, so an
`assess` outcome is written `unknown` today. Whoever builds the assessment runs it in a session the owner can see
(rule 2). It is the intake assessment of a stored record, separate from the outbound check's assessment of text about
to leave.

## Classifying what is already stored: `store classify`

`slopweaver store classify` sorts every row the store already holds by the same rules and the same facts intake uses
(`src/store/resolveDataClasses.ts`; the facts builders are shared in `src/store/dataClassIntake.ts`). It reads each
`content` row's source, kind, visibility, container native id and `author_native_id`, and each `owner_capture` and
`owner_turn` row's key and capturing app, never a body. It re-derives in both directions and writes only the rows
whose stored class differs, so a rules change narrows as readily as it widens and a second run writes nothing. A
`NULL` is always rewritten as an explicit `unknown`, so a row the pass reached is distinguishable from one it never
did, and an applying pass reads the three tables back and exits 1 if any `NULL` still stands (an import landed
mid-pass: run it again).

The census decides what "nothing left unclassified" means for the rest. Each table with no class column is counted
row for row and reported as failing closed. Each home register and home path is listed by its declared name and never
read. `--dry-run` writes nothing, the store's migration catch-up included. The default report is counts, class names,
rule ids and declared names only, and a failure the database raised prints its SQLSTATE, never its text, which can
quote a stored value. Every hand-written statement names the `public` schema, so a lookalike table earlier on the
`search_path` cannot pass the read-back that checks for a remaining `NULL`. `--sample <n>` adds up to that many row ids per most-private class (`restricted`,
`personal`, `unknown`), for the owner's own check in a visible session, and they are never copied onto a page,
message or pull request. An unusable rules file refuses the pass exactly as it refuses an ingest.

## What is not built yet, and what waits on the owner

- **Who classifies, and with which model and budget, is the owner's open call** (the page that asks it, "Who
  classifies what you say on calls"). Nothing here runs an assessment, names a model or schedules a reader.
- **`owner_capture` and `owner_turn` rows are not sorted at write yet.** They are written `NULL` and read as `unknown`,
  which is what the default rule's `assess` outcome writes anyway until an assessment exists; `store classify` writes
  their explicit class afterwards.
- **The row-level security policies do not read the class yet.** A policy edit is not additive, so the door would
  refuse to catch a store up to it; it lands with the step that makes a narrower reader identity actually use those
  policies.
- **Derived knowledge and pages do not inherit a class yet.** The owner's scheme gives a derived lesson or page the
  highest class of anything it came from, and the higher class when a source cannot be named; no derivation writes
  one here.
