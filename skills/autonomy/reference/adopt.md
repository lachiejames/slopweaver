# `autonomy adopt` — how a repair decides, and what it never touches

Part of [the autonomy skill](../SKILL.md) § Repairing a register file before its import. Adopt edits the
legacy `ledgers/autonomy.jsonl` only, before `store import-fleet --only autonomy` takes it; once the store has
imported it, adopt refuses.

## A derived said

The derivation opens the slugs out into the sentence somebody already wrote — a board row slug IS English
with hyphens in it — and it REFUSES rather than guessing: a subject the register cannot classify, one whose
opened-out form still carries a session id, and one carrying a turn reference the opening-out would LAUNDER
(a hyphenated number pair becoming the same two numbers with a space, which the shared criterion cannot see) all get no line, and the card says it
has none.

**It never touches a said a SESSION wrote, and it may correct one it wrote itself.** Those are two rules, not
one: a derived line is adoption's own output, identified by the provenance sentence it ends in, so a
sharpened derivation can rewrite it or take it back. Without that the one field this register exists to
protect would be the one field no fix could reach. MEASURED (`slopweaver autonomy adopt --home
"$SLOPWEAVER_HOME"` reports and writes nothing): of 700 acts, **674 carry a said and 26 carry none** — and
the pass that added the laundering sense RETRACTED thirteen lines an earlier pass had written.

## A named field

The value decides the field, so there is one form rather than two: a **checkable id** (an http(s) URL, a
board row slug, a `state:` reference) repairs `subject`; an **ISO-8601 instant** repairs `doneIso`. Those two
spaces cannot overlap — an instant carries colons no board slug admits, and no URL or `state:` prefix can
open one. Both refuse an act whose value ALREADY reads, because rewriting a subject a reader could follow,
or restamping when an act happened, is editing history under cover of a repair. Nothing is inferred: you
name the exact value or there is no repair.

`doneIso` is in that set because of one row. MEASURED: a hand-appended act carried a truncated instant
(`2001-01-01T03:1xZ`), and the ledger's decoder refuses that line, so the import stops on
it until it is repaired. Appending cannot fix that, and re-recording under the act's own id is an
`ACTION_ID_CONFLICT`, since `doneIso` is an identity field.

**A repair reaches the ACT and never the owner's steer of it.** Acts and steers live in one file and a steer
carries the act's own `actionId`, so a repair matched on the id alone would reach both rows and write a
hybrid the reader refuses, leaving every act the owner has spoken about unrepairable. A repair skips
a `steeredIso` row, and naming an id only a steer carries answers "no act in the ledger carries the id"
rather than silently doing nothing. A row-level refusal names its LINE, the act, and the command to type.
