# A turn that does not finish

Bundled reference for the `loop-bot` skill: what survives a turn that dies, what a fresh session on the same
ask is handed, and how the incident becomes a test instead of a memory.

## The measured turn this exists for

Ask `C0SYN000008/1789046247.801199`, on a tag the owner posted personally in front of the platform team.
The worker was dispatched, spent 49 minutes and 61 tool calls, ran two serial reviewer rounds, and
then its session died with `API Error: Connection lost mid-response` — one line after writing that
round 2 had found a real error in its cross-service claim and that the live probe gave a much better answer.
Zero public output. The thread froze on a card reading "61 tool calls so far". A later session
re-investigated from nothing and only answered much later.

## What is checkpointed, and when

**Every draft that passes validate.** `turn resume --dispatch <id> --answer <path>` copies the bytes into
`live/slack/checkpoints/<channel>-<messageTs>/draft-<digest>.json` and appends a row to that directory's
`log.jsonl`. You do nothing to opt in. The `answerPath` the marker records is a path you chose, typically a
session scratchpad that goes when the session does, so the bytes, not the path, are what survives.

**Every round's verdict.** `reviews/<key>/` holds `verdict.json` plus one
`verdict-superseded-<reviewer>-<spawnedAt>.json` per displaced round, and one `answer-reviewed-<digest>.json`
per round; the resume brief below reads them back.

The checkpoint write is best-effort: it can never fail your validate. A disk problem costs the insurance, not
the answer.

## What a fresh session is handed

`turn resume --dispatch <id>` prints a `RESUMING FROM CHECKPOINT` block whenever either half is present:

- the draft to start from, with the instant it validated and the digest a round would bind to;
- one entry per round, oldest first, at the reviewer's own spawn instant, carrying that round's outcome, how
  many claims it SETTLED, and every claim it left standing with its impact and support.

**Verify it rather than re-derive it, and never re-litigate a claim a round already settled.** A round whose
verdict will not parse is reported as unspent rather than as absent — treat it as work still owed.

The block is absent, not empty, when there is nothing to resume from, so an ordinary first dispatch reads an
identical brief.

## What the thread sees

The card's running step says `resuming from checkpoint — …` in place of the mechanical `now:` line, and it
counts only what an EARLIER dispatch generation produced. A round you run yourself is never reported as
recovered from the last session. Both writers of that one message — your own `turn watch` ticker and the
loop's sweep — derive it the same way, so they cannot disagree.

## Freezing the incident

```bash
slopweaver turn freeze --ask <channel>/<messageTs> --out src/__tests__/fixtures/replay/<slug> \
  --incident "<what went wrong, in your own words>" [--through <kind>] [--not-after <iso>] \
  [--regresses <register class>]
```

Freeze BEFORE anything cleans the record set up — a re-dispatch overwrites it. The fixture carries every
review round and every checkpointed draft, redacts by allowlist, and REFUSES rather than emitting a leak.

`--through <kind>` cuts the lifecycle log before the defect fired. **`--not-after <iso>` is the cut for a
defect that fired BETWEEN two lifecycle rows** — a worker dying mid-response writes no row at all, so no kind
can name the moment before it, and `--through dispatched` on the turn above would have cut off both rounds it
actually spent. The instant is also the clock a replay judges the fixture by.

The lane's rules — redaction by allowlist, the fixture's own clock, and asserting on a falsifiable witness
rather than on silence — are `.claude/rules/testing.md` § the replay lane.
