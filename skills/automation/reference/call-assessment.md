# A call-assessment row — what the owner said and wrote, classified

The owner ruled one daily visible reader that classifies what the owner says on calls and extracts what it teaches,
on the plans already owned, with no new spend. The same reader then classifies the day's slice of stored rows the
data-class rules send for assessment: the owner's dictations and Codex messages, and private-lane mail and direct
messages. `call-assessment-daily` is the declared row ([declared rows](declared-rows.md)): daily 21:30 in the machine's
time zone, kind `call-assessment`. No process calls a model for it (rule 2): you are the reader.

**What you produce is local state only**: verdict lines in the register `talk assessment-record` and
`store assessment-record` write (`judgement/data-class-assessments.jsonl`, no text in it), and knowledge rows from
calls. You send nothing, post nothing, never write a stored row's class (`store classify` reads your verdicts later),
and never touch whether anything is shown beyond the owner: a class is an input to that switch, never the switch
([data classification](../../../docs/store/data-classification.md)).

## The words are never reworded

A passage is one stretch the owner spoke, exactly as the call file keeps it, and `talk assessment-due` prints it
byte for byte; a stored row's title and body are printed the same way by `store assessment-due`. Classify the words
as they stand: never paraphrase, summarise, correct a transcription or merge two passages or rows to decide one.
Words you cannot decide from themselves and what is around them are `undecided`, which keeps them `unknown`, read as
`restricted`. That is the safe answer, never a failure.

## The classes

For a call, highest wins: the call carries the most private class any passage holds, computed by the verb, never by
you. A stored row carries the one class you give it.

- **`public`** — fine for anyone to read: nothing about a person, a customer, an employer's internals or a secret.
- **`internal`** — work talk fit for the owner's colleagues, not the world: plans, systems, decisions.
- **`personal`** — about the owner's own life or another person as a person: health, family, feelings, money, plans
  outside work.
- **`restricted`** — a credential, a customer's or employer's confidential data, or anything whose spread would harm
  someone.
- **`undecided`** — the words alone do not settle it. Say why in the reason.

A reason is one sentence, at most 300 characters, saying what decided it. It may describe the words; it never quotes
them past a few words.

## The order is the contract

You were seated with ONE command, `slopweaver automation run-due --recipe call-assessment-daily --claim-id <token>`.
**Run it LAST**: its `store assessment-due --check --with-calls` prints counts only and exits deferred while any call
is due or the day's slice of stored rows has one due, so a firing you did not finish stays unstamped and the reader
is seated again.

### Calls first

1. **Read the worklist.** `slopweaver talk assessment-due --json`. Each `due` entry is one call: its `callId`, its
   `requestSha256`, and its `passages`, each a `segmentId` and its verbatim `text`, oldest call first. `live` calls
   are still being spoken on, `incomplete` ones have a line that would not parse, and `foreign` ones hold a stretch a
   console not the owner's wrote; none is yours this firing, and each stays `unknown`.
2. **Classify every passage of one call.** Write a file in your scratchpad:
   `{"verdicts":[{"segmentId":"…","class":"internal","reason":"…"}]}`, one entry per passage, none missing, none
   repeated.
3. **Record it.** `slopweaver talk assessment-record --call <callId> --request <requestSha256> --verdicts-file <path>`.
   A refusal names what to fix: a missing or extra segment, a reason too long, or words that changed since you read
   them, in which case read the worklist again. Recording identical verdicts twice writes nothing; different verdicts
   for the same words are refused, so decide once.
4. **Record what the call teaches.** A real lesson or preference of the owner's, stated or plainly shown, is a
   `slopweaver knowledge record --learner owner` row ([knowledge](../../knowledge/SKILL.md)), placement decided first.
   Its evidence cites the call and segment ids. It quotes the passage verbatim only when that passage is `public` or
   `internal`; a `personal` or `restricted` one is cited by id alone, never copied into a register more surfaces read.
   Most calls teach nothing new: record nothing rather than a restatement.
5. **Repeat until `due` is empty.**

### Then the day's stored rows

6. **Read the slice.** `slopweaver store assessment-due --json`. Each `due` entry is one row, newest first: its
   `table`, `rowId`, the `ruleId` that sent it, its `requestSha256`, and its `title` (or null) and `body` verbatim. At
   most 25 rows are recorded per local day; `counts.moreDue` says an older backlog waits for later days, which is
   expected and never yours to finish today.
7. **Classify every row.** Write one file in your scratchpad:
   `{"verdicts":[{"table":"…","rowId":"…","ruleId":"…","requestSha256":"…","class":"personal","reason":"…"}]}`, the
   four keys copied exactly as printed, one entry per row.
8. **Record them.** `slopweaver store assessment-record --verdicts-file <path>`. Each row is re-read from the store
   first; a row whose words or rule moved since is refused by name while the rest are recorded, and a refused one
   comes back due on the next read. Stored rows teach no knowledge rows: a mail or a message is not the owner telling
   you something about themselves.
9. **Then run the claimed `run-due`**, and answer in the board row with the counts it printed and the knowledge row
   ids, if any. Never a row's words, and never a count of what the store holds beyond what `run-due` printed.

## What ends the seat with nothing recorded

A day with no calls and no stored row due, or only ones already assessed, is a clean firing: run `run-due` and say so.
A worklist or slice that fails to read is a failure, never "nothing due": quote its message in the board row and stop.
