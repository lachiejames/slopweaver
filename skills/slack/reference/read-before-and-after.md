# Read before and after every send

The rule: read before and after the fleet acts, the way Playwright does. Five checks, each in code and
each held down by a replay-lane test. Four run without you; the fifth is a verb you run.

## 1. Before a release: the thread is re-read since the draft's own read

`slack post|reply --draft <id> --approve <digest>` re-reads the conversation the row lands in, since the newest
message the recording read (`readThrough`, or the recording instant on an older row). A message added, edited or
removed in between refuses the release and prints that exact `ts` set; a tombstone newer than the read is a message
posted and removed since, and an edit stamp that is not a string counts as an edit. The recording keeps every message whoever wrote it, and the release leaves out only one that
reads now as the posting token's OWN bot post, added or edited, so a wrong identity refuses more and never misses. A
person posting through an app carries its `bot_id` beside their own `user`, so another app's message counts too and
costs one clearance. A recording that read an empty channel keeps the zero `ts`. A reply re-reads its whole thread by cursor; a top-level row re-reads from the first of the newest messages
its recording snapshotted, five pages at most, and a set past that is unreadable, so the draft is dropped. A row addressed
to a person opens that DM and reads it from the recording instant, so it sees additions only (a newer tombstone
included), because no DM was opened before approval. An older reply row with no read-through re-reads its whole
thread, so it also sees an edit stamped after the recording; neither sees an older message removed. Slack has no
conditional post, so a reply between the re-read and the send is the residue; a top-level re-read is bounded at the
instant it starts, so that window opens there. A failed `auth.test` refuses the release like an unreadable thread.

**Approval never expires by age**: a day later it still stands, nothing reminds the owner an approved
message is unsent, and the re-read looks for a MATERIAL change, never a fresh approval. Read what moved, then pick
one remedy — never "re-record it for approval":

| What the re-read found                       | Remedy                                                              |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Nothing that changes what the message means  | `--thread-moved-cleared <the printed ts set>` — sends it as is      |
| It is no longer needed (someone else did it) | `--thanks-instead "<one line>"` — sends only thanks, closes the row |
| It is wrong now, and thanks would be odd     | `slopweaver slack draft drop <id>` — withdraws it                   |

`--thanks-instead` is the owner's own shape: the fleet checks just in time before sending, sees the message is
no longer needed, turns it into thanks for the review and takes it off the owner's board, with nothing further
for the owner to hear. It releases an `--as me` row only; a bot row is dropped. Thanks re-reads too, so pass the set you judged beside it
(`--thanks-instead "<line>" --thread-moved-cleared <ts,...>`). A cleared set is compared exactly: a newer reply
refuses again. Code: `src/outbound/slack/releaseFreshness.ts`.

A row that re-asks an earlier question re-reads THAT thread too, and refuses on an answer since its recording
([asked-before](asked-before.md)); the thanks lane re-asks nothing and skips it.

## 2. After every post: read back where it landed

Every guarded post (`slack post|reply`, a turn's answer) reads the message back and compares Slack's own `thread_ts`
against the address it asked for; a DM addressed to a person is judged by who is on the other end of the `D…`
Slack answered with. A failed read acts on nothing, and its journal row keeps the thread it was sent to. Code:
`src/corpus/slack/writeGuardPlacement.ts`, the verdict in `writeGuardPlacementCore.ts`, the repair in
`writeGuardPlacementRepair.ts`.

## 3. A misplaced post is repaired, automatically and journalled

The owner's ruling: delete it and put it in the right place, automatically, without asking the owner. The
exception is when people have already started engaging; a mere reaction does not count, and the post is moved
automatically.

- **Nobody replied after it** → repost the same arguments where they were addressed, read that back, THEN delete
  the misplaced one. Repost first: every failure leaves the original standing. The conversation is read once more
  just before the delete; a reply that arrived meanwhile takes the repost back and cross-links instead. Slack has no
  conditional delete, so a reply in the instant between that read and the delete is the one residue.
- **A person replied** → leave it, post ONE cross-link at the intended address naming its permalink.
- A reaction is never engagement. A repost that lands wrong again is reported, never moved twice.

Every act is a row in `$SLOPWEAVER_HOME/live/slack/placements.jsonl` — intent first, result after.

## 4. Later: the bot's own threads are re-read for replies

`listen recover`'s scheduled sweep registers every thread the bot posted into in the last 14 days (off that journal),
cursor at the bot's FIRST message there, so a reply under it reaches the loop's existing ask detection after the root has
left every history window. Nothing new answers it: a reply that tags or addresses the bot becomes an ask exactly as a
live one does (rule 2 holds). The window picks which threads register; one registered stays in the sweep's state. A
thread the sweep never ran for in its first 14 days is not re-read later: `conversations.history` lists roots, never
threaded replies, so only the live listener sees a reply there. Code: `src/live/listen/recoverOwnThreads.ts`.

## 5. A claim newer evidence contradicts is corrected IN PLACE

When a later read (a reply from check 4, a follow-up turn, a fresh investigation) shows a claim the bot made is
wrong, edit the ORIGINAL: strike the claim, put a bold **Correction:** line directly under it.

```bash
slopweaver slack correct --channel <id> --ts <ts> --wrong "<the claim's exact words>" \
  --correction "<what is true now>" --dry-run
```

- **Never a delete, never a bare reply** — readers acted on the original, so the fix sits where they read it.
- **It rides the original send's approval.** Only a message Slopweaver sent; every other word, the media and the
  metadata stay. `--as bot` (the default) takes a card or answer this bot posted. `--as me` takes a message sent
  under THE OWNER's name and edits with the owner's token, proven by its `released` row in the as-me draft register:
  parked as the owner, under the user `auth.test` names, at exactly this channel and ts. A message the owner typed
  themselves has no row and is
  refused, and so is a row parked before the register named its user (`src/outbound/slack/asMeAuthorship.ts`). `--wrong` must occur exactly once; the result is read back and a second run is a no-op.
  `chat.update` has no edit-version precondition, so an edit landing between the read and the update is the residue.
- **The owner's magnitude line**: ten and thirty are the same order of magnitude, not a meaningful difference. A
  difference of an order of magnitude materially changes an incident's impact and severity, and the owner
  may want to know before the fleet sends. The verb computes the numeric half: any figure moved by
  10× or more against the same position in the correction (a version is not a figure), zero against non-zero, or
  a figure count that differs so no pairing is computable, is HELD until you `handover ask` the owner on the Queue and re-run with
  `--magnitude-seen <the owner's answer's anchor>`. A worded change it cannot measure stays your judgement, on the same line.
- **Urgent** — the readers acted on it — also parks a DM per person with `slack draft record`, then names it:
  `--urgent --notify-draft <id>`. The verb checks the row is a held DM and never sends one (rule 10).

**Not a supersede.** `loop-bot`'s follow-up answer that REPLACES an earlier one in the same thread still
supersedes it ([posting](../../loop-bot/reference/posting.md)); `correct` is for a claim found wrong on a later
read, where no replacement answer is being posted. Code: `src/outbound/slack/claimCorrection.ts`, the block
surgery in `claimStrike.ts`, the magnitude line in `claimMagnitude.ts`.
