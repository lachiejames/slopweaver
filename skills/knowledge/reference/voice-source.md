| | the `memories` table || | the `memories` table | `knowledge/proposals.jsonl` |

# Reading the owner's own words, and proposing what the owner believes

Bundled reference for the `knowledge` skill. Loaded when the body links here, not on every turn.

The source of a proposed belief is **the owner's voice dumps**, read for statements the owner made
about how something works, the confident ones and the ones the owner flagged as guesses.

## The one thing to understand before running anything

**A proposal is not a lesson, and the two stores are different.**

|            | the `memories` table                                | `knowledge/proposals.jsonl`                                          |
| ---------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| holds      | what an investigation PAID FOR                      | a candidate belief read out of the owner's speech                    |
| owes       | `evidence` that was OBSERVED, a `tier`, a `verdict` | a `quote` of the owner's own words                                   |
| written by | `knowledge record`                                  | `knowledge propose`                                                  |
| becomes    | nothing; it is the answer                           | a row of the owner's in the register, once the OWNER has answered it |

None of `evidence`, `tier` or `verdict` can be honestly manufactured from a sentence the owner said out loud, which
is why a proposal cannot be a `LessonRow`. Recording one as a lesson would fill the register the whole
`--repeats` mechanism reads with unmeasured guesses.

## The two verbs

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge voice [--batch <n>] [--source <kind>] [--out <path>]

"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge propose --from <batch> --unit <id> \
  --domain <slug> --claim "<one sentence>" --quote "<the owner's exact words>" \
  --held stated-uncertain|stated-confident [--run <slug>]

"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge propose --from <batch> --unit <id> --none "<why nothing>"
```

`voice` gathers; **you** read. It runs no model and proposes nothing, because `AGENTS.md` rule 2 forbids a
headless one and reading a turn is a judgement — the same split `skills/distil` already makes.

## Three sources, and what each is worth

MEASURED on the owner's real home, through the verb itself
(`slopweaver knowledge voice --batch 0 --json | head -1`): **22,055 recordings collapse to 451 distinct
units.**

| Source         | Recordings | Units | What it is                                                                                                                                                                |
| -------------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tick-ledger`  | 1,913      | 53    | the supervisor tick ledger's own `ownerTurns`. Structured, carries an instant and a turn uuid, and **the owner's words alone**                                            |
| `archive-turn` | 206        | 206   | `handovers/archive/owner-turn-*.txt`. Durable, one file per turn                                                                                                          |
| `scratch-turn` | 19,936     | 371   | `supervisor-scratch/<handoff>/owner-turn-*.txt`. Each successor copies the previous scratch directory forward whole, which is where nearly all the duplication comes from |

Identity is `sha256` of the **exact bytes**, deliberately not the lesson id's normalisation: two recordings of
the owner's speech that differ by a character are two recordings, and merging them would silently pick one of
the owner's wordings to keep.

The two file families are found by ONE walk (`src/store/fleet/ownerTurnFiles.ts`), shared with `store
import-fleet --only owner-turns`, which stores the same files byte-exact in `owner_turn` keyed by that same
sha256 — so the scan and the store cannot disagree about which files exist.

## `wrapped` is the field to read before you quote

A turn FILE is something a supervisor seat wrote **around** the owner's words: a provenance header, the
owner's verbatim turn, and usually a paragraph headed `SUPERVISOR READING`. So every unit from either file family carries
`wrapped: true` and the batch prints a warning on it. Only `tick-ledger` units are the owner's words alone.

The quote check proves a span occurs in the unit. On a wrapped unit **that is not the same as proving the owner
said it** — you could quote a supervisor's sentence and record it as the owner's, and nothing downstream could tell.
That check is yours.

## What the verbs check, and what they cannot

Checked mechanically, and each refuses rather than warning:

- the batch file is one this code wrote, and its unit still hashes to its own id (`UNIT_TAMPERED` means
  re-scan, not repair);
- the unit is in the batch you cite (`UNIT_NOT_IN_BATCH`);
- **the quote occurs in the unit**, tolerating only line wrapping — a tidied, re-punctuated or paraphrased
  quote is refused (`QUOTE_NOT_FOUND`);
- the domain is a slug and the claim fits in a sentence.

Not checked, and not checkable: whether your claim is a fair reading of what the owner meant.

## Both outcomes are rows, and that is what makes the queue finish

`--none "<why>"` is a first-class answer, not a skip — the same call the run-closing lessons gate makes. What
has been reviewed is DERIVED from the queue's rows rather than from a cursor file, so a batch that was
printed and never answered advances nothing, and a repeated `knowledge voice` reaches new material instead of
re-offering the same units forever.

`--batch 0` asks for the watermark alone. Read the watermark first: how many units the scan found and how
much of what the owner has said this installation holds are different claims, and only the first is one the verb can
make.

## The other half: where the owner corrects it

A proposal waits in the queue until the OWNER answers it. `slopweaver briefing render --owner-beliefs` projects the
open ones onto the Fleet Briefing below react-now — the shape is
[owner-beliefs.md](../../supervisor/reference/owner-beliefs.md) — and the owner answers by telling the supervisor
the proposal id and one of `right`, `wrong` or `partly`. A visible session records that with
`knowledge answer`, which refuses an id the queue does not hold and one already answered, and says which of
the two: they lead to opposite next actions.

**The owner's mark is a REACTION, not a verdict, and nothing maps one onto the other.** `right` says the fleet
read the owner's knowledge correctly. `confirmed` says the claim is true. The owner can be right that they
believed something and
the belief still be false — that is the most interesting row the register can hold, and an automatic mapping
would erase it. So `knowledge answer` writes no register row: `knowledge record --learner owner` is a
separate, explicit act that owes a verdict and evidence that was OBSERVED, neither of which a mark supplies.

`--correction` carries the owner's own wording and is absent unless the owner supplied one, on every mark
including `wrong` — the owner may say a claim is wrong without saying what the right one is, and inventing the
replacement is what this queue exists to stop. `--why` carries the owner's words rather than a session's summary
of them, and
`"right"` on its own is a complete answer.

## Two readers that count the owner's rows differently, and why

`learner` is not hashed into a lesson's id, so the owner's row and the fleet's for one claim share one. Two readers
had to be narrowed rather than left alone:

- **`knowledge list --repeats` defaults to `--learner fleet`.** Grouping both sides would report a repeat
  "two runs learned independently" when exactly one fleet session ever learned it. An explicit `--learner`
  still wins, including `--learner owner --repeats`, which asks which of the owner's beliefs the owner has stated twice.
- **The `handover settle` lessons gate counts only fleet rows.** Writing down something the owner said is not the
  run having learned anything, and counting it would be the filler that gate exists to refuse.
