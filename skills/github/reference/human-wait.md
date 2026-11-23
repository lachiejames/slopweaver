# A row waiting on a human — `humanWait`

Every `github landing` row whose act is `blocked-on` carries `humanWait` (`src/review/humanWait.ts`): the five
facts the owner asked for, in place of a bare verdict word.
Every other row carries none.

| Field             | What it is, and where it is read from                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `who`             | the row's `blockedOn`: the code owners GitHub still holds it for                                        |
| `requestedAtIso`  | the EARLIEST of each holder's newest `ReviewRequestedEvent` (`src/live/github/reviewRequestEvents.ts`)  |
| `lastAsk`         | the newest Slack message that asked someone to review it, with its permalink and who it went to         |
| `stale`           | `yes` once a business day has passed since the last ask, or since the request when nobody was asked     |
| `next`            | the ONE act only the missing fact can settle (below)                                                    |
| `slackThroughIso` | on a `sync-slack` wait whose corpus is PROVEN behind, the watermark it is stale since; absent otherwise |
| `sentence`        | all five on one line, which the Pull requests page and the console voice print verbatim                 |

`next` is one of seven words:

- **`name-the-reviewer`**: nobody was asked and every holder is a TEAM, so an ask has no person to go to
  until the owner names one. This is the one next act that needs the owner's word.
- **`ask`**: nobody was asked and a named person holds it, so the fleet drafts the ask as the owner and PARKS it
  (`slack draft record --act review-ask`) for the owner's yes, or, with no agreed discussion or obvious bug, parks a
  discussion opener instead (`--reviewer not-an-ask`, never `--act review-ask`) — a Slack message to a person is never sent unasked
  ([rule 10](../../../docs/doctrine-rationale/rule-10.md)).
- **`bump`**: the last ask has had a business day of silence, so the chase is drafted and parked the same way, with
  `--act bump`. What
  the fleet does NOT wait on is the pull request itself: a red or behind head with an ask out is fixed first,
  unasked, because a chase on a broken pull request is the bad look the owner named.
- **`wait`**: the ask is inside its business day, or somebody replied.
- **`wait-on-channel`**: the owner posted it to a channel and named nobody, and the channel's clock reads green or
  yellow (below). Nothing is drafted: the channel has it.
- **`read-the-messages`**: the Slack window is complete, but a message the classifier abstained on still needs a
  visible session to read it.
- **`sync-slack`**: the Slack window cannot bound an absence, so a sync settles it. When the corpus is provably
  behind — it ends before the pull request's last activity, or the live search saw a newer message — the sentence
  says `Slack history stale since <watermark>, sync to know`; with no watermark proving that (never ingested, or
  a timestamp that is not an instant) it says `Slack history does not settle this, sync to know`. Never a
  verdict: the window can say neither whether anybody was asked nor whether an ask found was answered. The Pull requests page draws that row's seat the same way, and its
  next-act tag, in the neutral tone, never the red `PAUSED … nobody seated` or `blocked-on` red.

**`bump` says a chase may be drafted, never who, where or whether today.** The day is the verb's one clock,
and it is a BUSINESS day: 24 hours of the owner's Monday to Friday (`src/review/businessTime.ts`), so an ask sent
Friday afternoon is due Monday afternoon, never Saturday. The standing rule: the owner
and the fleet think in business days and never expect people to review on the weekend. The day is a floor, since
in some cases the owner would wait longer, which is why `bump` offers and never sends.
WHO a parked draft goes to is the owner's review-asks preference row, never a name written here (`slopweaver
knowledge recall review ask reviewer --domain review`): the owner's newest word on routing replaces the row, so a
name in canon is the stale copy. The owner overrules a draft in the queue. The owner's marks still shape the chase ([what they
established](../../../docs/doctrine-rationale/rule-10.md#reeled-in-a-message-to-a-person-waits-for-the-owners-yes-the-owners-own-pull-request-never-does)).
Rosa and Tobias got a longer clock than the day. Reusing the thread of the owner's earlier ask matched the owner. After one
public chase drew no reaction the owner would probably have gone to a DM rather than bump in public again, and that bump's
broken link looked crap. Every other thread
quiet on the owner's ask two business days is `thread-chase`'s, which leaves a review of the owner's own pull request to this `bump`
([thread-chase](../../automation/reference/thread-chase.md)).

**The two `unknown` cases are split by what would settle them.** A sync and a session reading messages cost
different things, and if both read "could not tell", the one a session can clear this minute waits beside the one
it cannot.

**A request time is matched on identity, not spelling.** The codeowner read and the timeline can spell one team
two ways, so a printed-string miss would read as "never requested". A holder the timeline page did not carry,
on a page GitHub says holds older events, leaves `requestedAtIso` unread rather than dated off the pull
request's opening. The staleness is then `unknown`.

The page is `REVIEW_REQUEST_EVENT_PAGE` events (newest first), from the same query the fleet read already makes.

**An advisory-only red holds nothing.** Such a row reads its real hold, most often `blocked-on`, else `press`, and
keeps the red in its sentence. The tally's `advisoryRedBypassed` counts them, and `prs-backed-up` still skips any
row whose CI is red, advisory included (`src/monitor/sources.ts`).

**A `name-the-reviewer` row leads the judgment register.** The console draws it first there, as the question
"Who on `<team>` should review #N?", ahead of every owner-judgment row (`site/lib/landingRows.ts`). It is
always team-facing, so it ranks in the queue's first tier even when CodeRabbit also awaits it. When the owner
names someone to the supervisor, the session drafts the ask to that person as the owner (or a discussion opener, if
nothing agreed the change and it is no obvious bug) with `slopweaver slack draft record` and parks it. The draft then sits in the owner's queue's drafts register, and nothing is sent until the owner approves it.
A row the verb dispatches `draft-first-review-ask` draws no naming card: its seat drafts the first ask (or, with
no agreed discussion and no obvious bug, a discussion opener) and parks it with `slack draft record`, and that draft is the one card ([dispatch.md](dispatch.md)). Nor does a row
whose `github reviewer list` hook is `picked`: the approve parked the ask to the person the owner picked, and this verb
never reads that register, so its wait still says `name-the-reviewer` ([reviewers.md](reviewers.md)).

**Shared with a channel, nobody named, is the third review state**. `src/review/channelShare.ts` reads it off the
Slack legs' own search for the pull request's URL, never its body: a post of THE OWNER'S that links it, in a channel,
rooting its own thread as a message (the owner's link as a reply in somebody else's thread shares nothing, nor does a
file or pin of the owner's, which answers its own id with no thread under it), certified not an ask, with no ask anywhere, no undecided message, and no human review or thread on GitHub (a bot is
GitHub's own `Bot` actor type first, since GraphQL spells a bot's login with no `[bot]` suffix; an authorless
review, a deleted account's, is somebody GitHub cannot name and counts as a review). The
row carries `channelShare`, the post's permalink its citation, and a clock in business days
(`src/review/businessTime.ts`, Melbourne weekdays; weekends never count, holidays are not excluded):

- **green**, `wait-on-channel`: no reply inside the first business day, or a fresh reply under any of the owner's posts.
- **yellow**, `wait-on-channel`, stale: a business day with no reply, or the thread went quiet for one.
- **red**, `name-the-reviewer` or `ask`: `RED_AFTER_BUSINESS_DAYS` (`src/review/channelShareClock.ts`) with nobody reviewing. The owner's
  words were: a long time. Three is a provisional default, not the owner's number.
- **unknown**, `sync-slack`: past the first business day when an absence below was not read, or was read a
  business day or more short of now. Never a reviewer suggestion: the post was found, so "nobody asked" is not
  the reading.

Every colour but "in conversation" rests on an absence, and each absence has one carrier. **No ask** rests on
the corpus watermark, the one rule every absence in this read follows: only the exhaustive corpus establishes a
"no" (`src/review/absenceBounded.ts`). A live search collapses matches and honours the owner's
search filters, so even a complete one proves nothing absent, and a live hit newer than the watermark with
nothing read around it (`liveBeyondCorpus`) withdraws the watermark, as does a reply of the owner's a read thread holds and no
leg classified — URL-less, it may be the ask naming somebody — or the owner's post or reply Slack says was edited past the
watermark, since an edit keeps the key but not the version the classifier read. **No reply** rests on the whole thread
under each post, read at sync time whenever a Slack user token exists, `--slack-live` or not
(`src/review/channelShareEvidence.ts`) — an exhaustive read of one thread, since a reply need not link anything
and no search sees one that does not. A thread read whole is authoritative for its own rows, its root's too — a read
that returns no root, or one not the owner's, carries nothing, and nor does one whose two copies of a row disagree on its
author. A live hit cannot see an app's bot profile, so it never makes an app a colleague. An app is the corpus's
test, the `bot_profile` naming the row's own user, never a bare `bot_id` or `bot_message`: the owner's post sent with the owner's token through an
app carries that `bot_id` and is still the owner's. The owner's declared as-me bot reads as the owner there, through the same
`resolveOwnerBotToOwner` the corpus projection applies. The two horizons are carried apart
(`asksThroughIso`, `repliesThroughIso`, and `seen` in words, the badge's tooltip), so a line names WHICH one stops
short and what it could hide — an ask, a reply, or both. The clock is read AS OF the earlier of the two, never
`slack.bounded` (which ends at the pull request's last GitHub activity); a reply the thread read found past it still
counts, and a reply's quiet is measured to the thread reads.
Dispatch reads green and yellow as `waiting`, unknown as `unread`; the page and the voice hold the reviewer
suggestion until red, and until then its tag is not red and its seat is the channel's.
