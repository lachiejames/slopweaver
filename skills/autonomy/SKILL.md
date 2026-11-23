---
name: autonomy
description: Record every act you take under graduated autonomy into the autonomy ledger, read the ledger back, and record the owner's retroactive word about one act. The recording half of graduated autonomy — the register the Fleet Briefing's "done for you, without asking" section renders from. Use when you have just acted on the owner's behalf without asking (merged or enqueued one of the owner's pull requests, cleared a review thread, fixed red CI, rebased or restacked one), when you want to see what the fleet has done autonomously, or when the owner has said something about one of those acts and it has to be written down. Phrases like "record that I did this", "what have we done without asking", "the owner said that one was wrong", "log this autonomous action".
argument-hint: "record --action-id <id> --kind <slug> --subject <id> … | list [--unsteered] | steer <actionId> --steer <the owner's words> | steer-class <classId> --kinds <a,b> --steer <the owner's words> --anchor <where> [--subject-prefix <literal>] | adopt [<actionId>=<replacement>] [--apply] | qualify <actionId> --repo <owner/repo> [--apply]"
---

If you acted without asking, **record it before you move on**. A ledger that depends on somebody remembering
to write in it is a ledger that is wrong by the end of the morning, and this one is what lets the owner
correct the fleet rather than discover it.

## Why it exists, as the owner put it

Graduated autonomy means an obvious act on the owner's team-facing work is TAKEN rather than asked about. The
recording half is its pair: a ledger the owner can look at, like the react-now page but simpler, showing what the fleet took at this new graduated level of
autonomy, so they have the chance to give a retroactive steer on something they would have been fine with that
the fleet did not do, or something it did that they were not fine with.

So this is **not an audit log**. It is a steering surface, and it turns on the owner being able to READ a row.

That takes TWO accounts of one act, which is why there are two fields rather than one. `--said` is what the
owner reads; `--why` is what the next session reads. The owner's reaction to the act drawer is why they were
split — the card had been showing the owner the fleet's note, and the owner could not parse it at all.

## What to record

Every act you took **because it was obvious the owner would want it** rather than because the owner asked: a
merge or an enqueue of one of the owner's pull requests, an answer or a resolution on a review thread, a rebase
or a restack, a CI fix, and **a Linear edit on Acme work** — which `slopweaver linear issue --unasked` records
itself, with its activity history as the rollback, so never record it a second time by hand.

**A Slack message to a person is not on that list** (the owner's ruling): a review ask, a chase, a bump or a DM
as the owner that nobody asked for is parked with `slopweaver slack draft record` for the owner's yes, and an
arguable Linear closure is carded — until the owner approves the pattern ([rule 10's
rationale](../../docs/doctrine-rationale/rule-10.md)). The release the owner approved is the owner's own ask,
so it is not a row here either.

**Record the attempt, not only the success.** A press GitHub refused is an act the owner might want done
differently, and it is one of the more interesting rows in the register. Say so in the `kind`, and let the
`--witness` carry what actually happened. The register's own second row is `press-merge-when-ready-refused`.

**What NOT to record**: anything the owner asked for directly, and anything you carded to the owner rather than
doing. Those are the board's, not this register's. An act on Slopweaver's own repository IS recorded when you
took it because it was obvious rather than because the owner asked — `AGENTS.md` rule 10's criterion carries no
team-facing qualifier, the fleet has been recording internal acts since the register's first week, and a
`handover.rule.finding` the owner disagrees with is exactly the kind of thing a retroactive steer is for.

## Recording one

```bash
slopweaver autonomy record \
  --action-id <number>-enqueue \
  --kind press-merge-when-ready \
  --subject https://github.com/acme/acme-admin/pull/<number> \
  --by-session "workspace:<n> act-on-open-acme-admin-prs (<session-id>)" \
  --why "CI green, mergeable MERGEABLE, all 15 review threads resolved, two approvals, no code-owner request outstanding. The owner's standing word is that a PR with all the ticks only needs someone to press the button." \
  --witness "slopweaver github enqueue --pr <number> --repo acme/acme-admin -> 'queued #<number> into staging at position 1 (QUEUED)'"
```

Five of those fields decide whether the row is worth anything:

- **`--action-id`** is YOURS to choose, and you reuse it verbatim if you have to record the same act again —
  that is what makes a retry after a crash idempotent instead of a second row. Two records under one id must
  agree about every field or the second is refused. Name it after the thing: `<number>-enqueue`,
  `dev-alerts-batch-bump`.
- **`--kind`** is an open vocabulary, a validated slug with hyphens or dots. Name the real act rather than
  the nearest listed one; nothing here has a list to choose from, deliberately.
- **`--subject`** is the CHECKABLE id of the thing acted on, in one of three forms: an absolute http(s) URL
  the owner can open (a pull request, a Slack permalink), a **handover board row slug** (`slopweaver handover
resume <slug>` resolves it), or **`state:<path>`** for a file under the state home. Never a bare `#<n>`,
  and never a description — the field is an identifier, and a subject the owner cannot resolve leaves them
  steering a row whose target they have to guess at. Only the URL form renders as a link on the owner's page.
- **`--why`** is the FLEET's note, read by the next session. Write the REASONING — what you saw that made
  the act obvious — not a label. On the owner's Alignment card it is a line in the folded _the record_, so it
  reaches the owner only when they ask.
- **`--said`** is the same act in words THE OWNER reads: what you did, to what, and why it mattered. This is
  the line the owner's own card OPENS with, so it is REFUSED when it names a doctrine rule number, a slug or a
  session id — none of those mean anything to the owner, and the refusal quotes the token it caught. Write it
  as you would say it to the owner out loud, with no repository in the room. The slug sense starts at FOUR hyphen-joined
  segments and that floor is deliberate — three is where ordinary English lives (`day-to-day`,
  `end-to-end`), so a three-segment board row slug gets through and is yours to catch, not the door's
  (`src/autonomy/said.ts` § Two residues). It is also **capped at what the card can DRAW** — 60 words and
  4 sentences — because the owner's card renders what fits above the fold and the remainder nowhere, so a longer
  line would be cut there with nothing to open. The door refuses instead, naming which budget you crossed
  and by how much; the 400-character bound is a separate thing, and a line can cross either one alone.
- **`--said`, `--why` and `--steer` never carry a reference the briefing would leave bare.** `record` renders
  the act as the page will and refuses any `#<n>` left as plain text, such as one with more digits than the
  subject's own number. Any steer word (`steer`, `steer-class`, `record --steer`) is refused for EVERY bare `#<n>`,
  since it shows on other acts' rows too: write `owner/repo#<n>` or the full URL (`src/briefing/autonomyActRefs.ts`).
  The internal finding door holds an act to the same check: a bare `#N` its own links resolve to one repository
  is written `owner/repo#N`, and any other bare `#N` refuses the door ([qualify](reference/qualify.md)).

## Reading it back

```bash
slopweaver autonomy list                    # every act, newest first, with the owner's latest word on each
slopweaver autonomy list --unsteered        # the acts the owner has not reacted to yet
slopweaver autonomy list --json             # one JSON object per line
```

## Recording the owner's word

The owner reads the ledger on the Fleet Briefing and says something about a row to the supervisor, which writes
it down. The owner's word on an act given in the box on its card on the console's
[Alignment page](../../docs/console/alignment.md) is the same verb, run for them with `--by-session work-console`:

```bash
slopweaver autonomy steer <number>-enqueue \
  --steer "yep, exactly right — keep pressing those" \
  --by-session "fresh-supervisor-handoff-9240"
```

**The owner's words, as close to verbatim as you can get them.** Never your summary of them: the next session
reads this row to decide what the owner would want, and a paraphrase is where a preference quietly becomes
something else.

`--by-session` is PROVENANCE — which session wrote it down — and never proof that the owner said it. A second steer
on one act does not erase the first: both stay in the file and the newer one governs.

**A word on a whole KIND of act is one class steer, not a steer per act**: `autonomy
steer-class <classId> --kinds <exact,kinds> --steer "<the owner's words>" --anchor <where>` settles every act of those
kinds, before and after, and takes them off `--unsteered` and the owner's Alignment page. Exact kinds only, a word on
one act still outranks it, and re-recording a class replaces its list: [class steers](reference/class-steers.md).

**A word on the newest act of a PATTERN settles the whole pattern**: acts of one kind on
one subject or in one identical `said` are one card, and `autonomy list` prints the settled ones with the owner's
word on the pattern and the act it was given on. An act done under a rule the owner already confirmed is recorded with
`--steer "<the owner's word>"`; a rule cited only in `--why` settles nothing ([patterns](reference/class-steers.md#one-word-per-pattern-one-card-and-one-grade-settles-every-act-in-it)).

## Where it lives, and what that means

The store's `autonomy_event` table, through `src/autonomy/port.ts`: append-only, one validated record per
row, read in insert order. Nothing removes a row, and the one in-place edit is `autonomy qualify` below. An act,
then the owner's word about it, in the order they were written. One act per id is a unique index, so two sessions racing one id leave one act and
the loser reads it back; a write is never retried.

**Record through the verb; there is no file to append to.** A store that cannot be reached is a typed
refusal on every reader and writer, never an empty ledger and never a file fallback: the briefing, the
press-ledger guard, `talk` check-ins and steered cards and `fleet landed` all refuse rather than read "no
acts". `slopweaver store push` creates the table; nothing but the store URL is a credential.

**A home that still holds `$SLOPWEAVER_HOME/ledgers/autonomy.jsonl` is imported once:** `slopweaver store
import-fleet --only autonomy`. Until it has run, every read refuses `AUTONOMY_NOT_IMPORTED`, because an empty
table beside an unimported register would be a confident false history. The import inserts each line ON
CONFLICT DO NOTHING, reads it back, and marks itself done only when nothing diverged; a second run writes
nothing. A line the ledger's own decoder refuses stops the import with `AUTONOMY_LINE_REFUSED` naming it.

## Repairing a register file before its import

```bash
slopweaver autonomy adopt                 # what would change; writes NOTHING
slopweaver autonomy adopt --apply         # preserve the original beside it, install the adopted register

# repair one field, naming the act and the exact replacement — the VALUE says which field
slopweaver autonomy adopt '<actionId>=<UTC instant ending in Z>' --apply   # doneIso
slopweaver autonomy adopt '<actionId>=state:supervisor-scratch/list.txt' --apply  # subject
```

Four transformations and no others: a pretty-printed object is folded onto one line; a row with no
`witness` is given a statement of **recording provenance** naming the preserved original and its digest,
never manufactured evidence; a **field whose value this register cannot read** is replaced when you name
it, as `<actionId>=<replacement>` positionals; and a row with no `said` is given one DERIVED from its own
kind and subject, which says in the line itself that it was written after the fact. Every other field is
carried through, fields no type here declares included. A derived said never overwrites one a session wrote, a
field repair refuses a value that already reads, and a repair never reaches the owner's steer of an act: how each
decides, and the measurements behind it, is [adopt](reference/adopt.md).

This edits only the FILE, never the store, and it is bounded: and refuses
once the store has imported it (a repair there would edit a copy nothing reads); appending cannot fix a line the
reader cannot decode, the original is preserved and quoted in every patched row's own witness, and the
whole adopted register is read back through the ordinary reader before it replaces anything. `--apply`
refuses outright if a session appended while the plan was being read.

## Repairing a stored act's bare reference

```bash
slopweaver autonomy qualify <actionId> --repo <owner/repo>           # before and after; writes NOTHING
slopweaver autonomy qualify <actionId> --repo <owner/repo> --apply   # install it, the original quoted in the witness
```

The one edit of a stored row: a bare `#N` in the act's `why` or `said` becomes `owner/repo#N` against the
repository YOU name, nothing else changes, the owner's steer is never touched, and a row that changed since it was read
is refused rather than overwritten ([qualify](reference/qualify.md)).

The Fleet Briefing renders it under **done for you, without asking** — newest first, one line each, with the
said opening the fold and the why and the witness beneath it. The supervisor's sweep passes `--autonomy-ledger`; the composition contract is
[the supervisor's own reference](../supervisor/reference/autonomy-ledger.md).
