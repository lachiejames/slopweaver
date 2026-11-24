# A call-assessment row — what the owner said on each call, classified passage by passage

The owner ruled one daily visible reader that classifies what the owner says on calls and extracts what it teaches,
on the plans already owned, with no new spend. `call-assessment-daily` is the declared row
([declared rows](declared-rows.md)): daily 21:30 in the machine's time zone, kind `call-assessment`. No process
calls a model for it (rule 2): you are the reader.

**What you produce is local state only**: one verdict line per call in the register `talk assessment-record` writes
(`judgement/data-class-assessments.jsonl`, no passage text in it), and knowledge rows. You send nothing, post
nothing, and never touch whether anything is shown beyond the owner: a class is an input to that switch, never the
switch ([data classification](../../../docs/store/data-classification.md)).

## The owner's words are never reworded

A passage is one stretch the owner spoke, exactly as the call file keeps it, and `talk assessment-due` prints it
byte for byte. Classify the words as they stand: never paraphrase, summarise, correct a transcription or merge two
passages to decide one. A passage you cannot decide from its own words and the call around it is `undecided`, which
keeps the call `unknown`, read as `restricted`. That is the safe answer, never a failure.

## The classes

Highest wins: the call carries the most private class any passage holds, computed by the verb, never by you.

- **`public`** — fine for anyone to read: nothing about a person, a customer, an employer's internals or a secret.
- **`internal`** — work talk fit for the owner's colleagues, not the world: plans, systems, decisions.
- **`personal`** — about the owner's own life or another person as a person: health, family, feelings, money, plans
  outside work.
- **`restricted`** — a credential, a customer's or employer's confidential data, or anything whose spread would harm
  someone.
- **`undecided`** — the words alone do not settle it. Say why in the reason.

A reason is one sentence, at most 300 characters, saying what in the passage decided it. It may describe a passage;
it never quotes one past a few words.

## The order is the contract

You were seated with ONE command, `slopweaver automation run-due --recipe call-assessment-daily --claim-id <token>`.
**Run it LAST**: its `talk assessment-due --check` prints counts only and exits deferred while any call is due, so a
firing you did not finish stays unstamped and the reader is seated again.

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
5. **Repeat until `due` is empty**, then run the claimed `run-due`, and answer in the board row with the counts it
   printed and the knowledge row ids, if any.

## What ends the seat with nothing recorded

A day with no calls, or only calls already assessed, is a clean firing: run `run-due` and say so. A worklist that
fails to read is a failure, never "nothing due": quote its message in the board row and stop.
