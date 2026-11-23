# A draft the owner already said yes to is sent

Two drafts the owner approved on a voice call once sat held for seven hours. A yes on a call agrees what the draft
says but does not account for how the owner types, so the owner expects the fleet to handle that part and actually
execute the sending of a pre-approved draft unless there is a good reason otherwise.

## The rule

- **The owner's yes to a draft's CONTENT is the send.** Said on a call, in a relay or on the Queue, it is not a step
  toward an approval: release the row with the command `slack draft show <id>` prints. Never park it, or a re-cut of
  it, "for the owner's yes" again.
- **How the owner types is yours to fix without asking**: an em-dash, a drip split, a wrong or missing tag,
  lowercase, a bare reference made a clickable link. The owner approved what it SAYS; the voice gates and the owner's
  voice rules own how it looks, and the owner expects the sender to apply them.
- **Only two things earn a second ask**: a CHANGE OF MEANING (a sentence added, a stance moved, a person newly
  addressed), or a thread that MOVED MATERIALLY since the owner's yes, so the words now answer something else. Both are
  judgement; a release's thread re-read names the moves for you to judge.

## The mechanism

`slack draft record --approved <anchor>` records where the owner said it — `talk:<turn>`, `talk-call:<call>#<segment>` or
`transcript:<session>#<uuid>` — resolved to the owner's own words at record, or nothing parks. The row carries them as
`approval` (outside the digest), `draft show` prints them with the release command, and the list marks the row
`APPROVED`.

**The record holding the owner's words must not contradict the yes.** A bare "yes" on a post card was once approved
although the relay ruled `needs-more-info`, and a "just send it" from a relay about no card was approved onto a
draft. So `draft approve` and `record --approved` read the anchor's own record
(`src/cli/commands/slack/draftApprovalGate.ts`) and refuse, naming what it said, when:

- a relay's stored triage verdict is anything but `send-it`, or the relay predates storing one;
- a relay that carried no ruling, or a `call:` landing, holds words with no yes in them, or a yes beside a take-back
  (a remark the owner made with the draft's card open once bound as the owner's yes, because an open card was
  all the gate asked). A yes is a whole-word run from a closed list (`yes`, `send it`, `looks good`, `knock yourself
out`, … in `src/cli/commands/slack/draftApprovalWords.ts`) in a sentence that says rather than asks, sets no
  condition and reports nobody — "Should we send it to Tobias?", "If Tobias approves, send it" and "Tobias said yes" carry none; a `send-it` ruling is the
  affirmative act itself, so its words are not read;
- a relay's `about`, or a `call:` landing's card, is empty or names a card other than `post:<id>` of this draft or a
  cut it re-cuts or inherited from (an ask or hand card passes when its `draftIds` named one as the owner spoke).

**Nor may what the owner said after it on the same call.** The voice opens the next card
in the answer that relays the owner's ruling (about a second later), so "wait, no, not that one" is relayed about that next
card and the yes still bound. So for a relay or a `call:` landing the gate also reads the call's later relays while
the yes's card or one of the next two opened is up (`src/talk/approvalRelayRead.ts`), and refuses, naming the later
turn, when one carries a take-back or a verdict other than `send-it` and does not rule a card of its own. An unruled
relay over no card or the yes's own card refuses whatever its words, since no word list closes a take-back; words
decide only for an unruled aside on another card. A call it cannot find or read whole, a later turn it cannot read,
or one turn's lines disagreeing, refuses too. Either way, ask the owner which card the owner meant. All
three checks judge a yes as it is BOUND: a re-cut inheriting an approval (below) carries one already judged, so none
re-runs on it.

A row not yet parked had no card when the owner spoke, so a fresh `record --approved` on such an anchor binds through
`--supersedes <id>` of the row whose card it was, or by carrying that row's exact words (equal digest, checked under
the lock) — the re-record a landing that outran a drop owes. A `talk-call:` stretch and a `transcript:` turn are judged
by none of the three: a call is where the owner agrees content before any row exists. There is no hatch — record the yes the owner gives
on the card. `draft pick` reads the same words and is not a yes, so it is not gated.

A re-cut carries it. `--supersedes <id>` of ONE approved row inherits its approval, naming where it came from,
because a re-cut is how a mechanical fix is made. It judges no words, so the new row stands on the judgement of the
row it came from — its instant, the landing-ledger rows it read, and a `thread-moved`, `no-fleet-slot` or
`slack-refused` hold keeping it unsent — never on its own park: words landed past that boundary stay owed, and a
stated block stays the reason on the owner's card rather than a bare send. A re-cut MERGING several rows where one is approved is refused:
the merge would send words the owner never heard under their yes, so pass a fresh `--approved` naming the owner's yes
to the merged words, or `--meaning-changed "<what>"`, which records the change, carries no approval, and parks the
row for the owner's word. `slack draft drop` refuses an approved row whose note names a held re-cut carrying neither the approval nor a
`--meaning-changed`. Nor may a drop END a yes unsent: an approved row, or one the owner's unjudged words landed on, drops only
when its note leads to a cut that stands or a released cut of the same message, or is a whole `sent <ref>…` record of
where it went (below, `src/outbound/slack/draftSentNote.ts`) — prose merely CONTAINING a permalink, `not sent …`
included, proves nothing. Nor may a drop hand the owner's unjudged words to a held cut judged before they reached it: a
judgement counts the landing ledger, not which draft each landing was bound to, so judge them on the row first. A cut, held or released, counts only when the register RECORDS it as this row's message:
the same words, or a lineage of re-cuts each park records (`recuts`, what `--supersedes` named) or a yes inherited
from it — never an equal anchor, a shared opening line, or a note naming a row recorded without `--supersedes`, even
one carrying its own fresh yes (`recordedCutOf`, `src/outbound/slack/draftSpent.ts`). A release likewise spends only
the held cuts recorded as its message, and names, and keeps held, one that merely opens alike. When
the card landings cannot be read, or a card the owner's words reached after the row was parked has been swept, the drop fails
closed, and so does a bare `record --supersedes` of it, since a swept card binds to no cut; a `not-owner-yes` hold covers only such a landing at a ledger row it counted, never a ledger that will not read
nor a later yes. "Since" a change or a `not-owner-yes` hold is landing-ledger order wherever it was counted — a park carrying a
fresh `--approved` or `--meaning-changed`, and every `approve` and `hold`, records the rows it read — so words written
before it never read as the owner's answer, whatever instant the owner spoke them. A row whose meaning changed is not dropped until the owner's words land on its card since the change, so the reason
reaches the owner first, and that change never leaves on a re-cut: re-cutting it must re-declare `--meaning-changed` or name
a fresh `--approved`, and a drop onto a held cut carrying neither the change nor the owner's yes is refused. Otherwise hold it — the Queue card prints the reason —
and once the owner's word says not to send, `hold --reason not-owner-yes` sets the yes down and the drop goes through
(`src/cli/commands/slack/draftDropGuard.ts`). A `not-owner-yes` hold over a yes the owner RECORDED, or over a change of meaning waiting on the owner's
word, is your reading of the owner, so its reason reaches the owner first: the drop of that row or of any cut re-cut from it, and a
re-cut of it carrying neither a fresh `--approved` nor `--meaning-changed`, waits until a word of the owner's lands on the card
after the hold and is judged, and a later hold of any reason keeps it waiting. `approve`, `hold`, `drop` and `record`'s park and drops each read,
check and append under the register's write lock (`src/cli/commands/slack/draftRegisterLock.ts`), and `record`
derives a re-cut's approval again under it, so an approve landing while it read Slack is inherited and a drop is never
checked against a stale read. Both still read back after dropping, the backstop for a release, which appends unlocked.
`src/outbound/slack/draftApproval.ts` is the rule.

**A yes on a draft's CARD is judged where it landed.** The owner never again has to say "go send this" and come
back the next day to find it unsent. An owner's "Knock yourself out" once landed on an ask card naming a draft; the
draft was re-cut twice and the live cut sat parked for a yes the owner had already given. So a landing binds to every held draft its card names — a `post:<id>`
card its own id, an ask or hand card each `sd-*` id its drawn texts carry — followed through drop notes to the cut
that stands (`src/supervisor/draftLandingBinding.ts`). A session then records its judgement on that row, no re-cut:

- `slack draft approve <id> --anchor <where the owner said it>` — the owner's whole words bound to these words; the row now owes a
  send, and the receipt prints the release command.
- `slack draft hold <id> --reason <code> --why "<what you saw>"` — why it is not sent. `not-owner-yes` and
  `meaning-changed` set the approval down; `thread-moved`, `no-fleet-slot` and `slack-refused` keep it, a row
  approved but blocked. A release Slack refused, or one with no token to send under, is held `slack-refused`
  automatically; one whose pre-send re-read found the thread moved or an earlier ask answered is held
  `thread-moved` (`src/cli/commands/slack/releaseRefusalHold.ts`). A refusal by the send's own checks — the render
  proof, a high-stakes claim, the door — is journalled as a send failure and left to you to act on, not held.

**A settled yes sticks.** `hold --reason not-owner-yes` on a row carrying the owner's yes is REFUSED unless a word of the owner's
landed on its card since and no judgement has been recorded on it: the owner may change their mind, a session may not
re-read the words the owner already approved as "not a yes". The case: a draft approved on "It does, and I'm going
to approve sending it", then held `not-owner-yes` and put back on the owner's Queue as if unanswered.
`meaning-changed` and the three blocking reasons stay open; there is no hatch
(`src/cli/commands/slack/draftJudgementRun.ts` `settledYesRefusal`).

**Every hold is in front of the owner the pass it is recorded**: the post card LEADS with `NOT SENT (<reason>): <why>`
(or that its meaning changed and it waits on the owner's word) and either comes back past the owner's own landing or a waiting steer on it, so a yes not
being sent is never silent. A later blocking hold never hides an earlier reason: the card goes on to say the owner's yes was
set down, or its meaning changed, and why (`site/lib/postJudgement.ts`).

**The chair cannot leave one parked.** `supervisor tick-record` and `tick close` REFUSE a tick while a held row
carrying an approval, recorded before the tick started, has no hold; or while the owner's words landed on a draft's card
before it started and no judgement of the owner's words on that row has been recorded since — an approval, `not-owner-yes` or a
change of meaning; a blocking hold on a row never approved answers nothing, so approve first. "Since" is the landing
ledger's order when the judgement counted it: `approve` and `hold` record how many ledger rows they read
(`landingsRead`), so words written past them stay owed however early the owner spoke them (`src/supervisor/approvedDraftGate.ts`, hatch
`SLOPWEAVER_ALLOW_APPROVED_DRAFT_HELD`). A judgement of the owner's words — `approve`, a `not-owner-yes` or `meaning-changed`
hold, a judged park — is refused while the landings will not read, never recorded uncounted; a blocking hold judges
none of them, so it records uncounted and keeps the instant of the judgement it sits over. The refusal prints each row's release or approve command. A landed card
whose record will not read, or a landing-ledger line, refuses too, rather than passing as one naming no draft. So
does a landing whose named row a passed-over draft-register line may be, and any held row carrying the owner's yes, a change of
meaning or a set-down yes that such a line names, since the Queue hides it. A yes landing DURING a tick is owed by the
next one: refusing the tick that never saw it would wedge every close while the owner is talking.

**A landing can arrive after the drop it outran.** The transcript lands what the owner said whenever its batch runs, under
the landings lock, not the register's, so a landing written after `<id>` was dropped binds that dropped cut, on its
`post:<id>` card or an ask or hand card naming it: the drop never weighed it. "After" is the landing ledger's order, not the clock — the drop records how many
ledger rows it judged (`landingsRead`), because a writer stamps its instant before it appends — and an utterance that grew counts at the row its grown words
were written at, never the partial row the drop weighed. It is owed until its exact words are re-recorded as a row with `--approved <its anchor>`,
which then owes the send — another draft approved at the same anchor answers only its own card, since one sentence can
land on two, and that approval answers only the rows it counted, so words that grew past it stay owed even once it is
sent — or the card is put back with `talk restore --card <its card> --why "<why the drop stands>"`.
A drop that recorded the send owes nothing.

**Every chair must run a build that knows `approved` and `held`.** An older build reads those register lines as
unknown kinds, marks the rows they name unsure and refuses on them; rebuild the seat (`slopweaver dev build`).

## A channel the owner is not in

A user token cannot post where its account is not a member: `chat.postMessage` refuses `not_in_channel`. An approved
draft was once refused hours after the owner's word for this reason, and the only route left was a
floating note asking the owner to join by hand. So `slack post|reply --as me --draft <id> --approve <digest>`, once
every gate has passed and before it sends, reads the owner's membership (`conversations.info`) and, when the owner is
outside a PUBLIC channel and the row carries the owner's yes, joins it as the owner (`conversations.join`) and then posts — one run, no hand step, no card.

- **The join is its own act on the autonomy ledger** (`slack-join-public-channel`, id
  `slack-join-<channel>-for-<draft id>`), separate from the send, which is the owner's ask and never a row there.
- **A row without the owner's recorded yes is refused** before anything joins or posts, naming `slack draft
approve`: joining a channel as the owner is an act on the owner's account, and a digest typed at release is a
  session's word, never the owner's. The owner's yes is re-read off the register right before the one join request
  goes out, and again if it fails, so a yes withdrawn mid-release joins nothing and is never held `slack-refused`
  over the owner's own hold.
- **A private channel is refused with the reason** — Slack cannot join one, and only a member can invite the owner —
  and holds the owner's yes `slack-refused`, as does a join Slack refuses (an archived channel). Either hold reads the
  owner's yes off the register as it stands then, so it never writes over one the owner withdrew while the release ran.
- **A dry run reports the join and takes none**; a membership the read could not answer joins nothing, and the send
  meets Slack's own refusal exactly as before.

`src/outbound/slack/channelJoin.ts` is the rule and `src/cli/commands/slack/releaseJoin.ts` the step; the cassette is
`src/__tests__/integration/slackChannelJoin.test.ts`. A fresh `--as me --channel` send with no `--draft` never joins.

## A drip split of an approved row

A parked row is one message, so a split into drips cannot be parked. Send the split yourself, `slack post|reply --as
me --form -` with the drip form ([as-me-lane](as-me-lane.md)), then `slack draft drop <id> --note "sent <permalink>,
<permalink>"` so the row names where the owner's words landed: nothing but `sent` and the permalinks, each in the row's
channel and posted after it was parked. The drop reads each one from Slack first and refuses unless the row's
author posted it and the parts, in note order, are the row's words; a note alone never proves a send. One message
named twice is no record, the row's media must be on the messages by name and byte count, and a card's or no-fold
row's blocks must stand in the one message it names (`src/outbound/slack/draftSentContent.ts`).

## Residue

Whether the owner's words at the anchor MEAN yes to this draft is your judgement: the gate refuses an unruled relay or a
landing with no yes in it, but a closed list cannot read whose yes it is — "Tobias's happy with it" carries one — and a call stretch or a typed turn is never read for
one — there a whole "no, don't send that" resolves like "send it". So read `heard` before recording and before releasing, never alone: a bare "yes" is
unreadable without the question it answered. The tick gate's landing line, `talk unread` and the relay's typed line each
print the voice's turn before the owner's words and the relay's stored verdict (`src/talk/answerContext.ts`), and the gate lists
the command that verdict matches first; a row whose words are not the owner's yes is held `not-owner-yes` naming why. The verdict, affirmative, card and later-relay checks read only a relay and a `call:` landing: a call
stretch or a typed turn stays wholly your reading, whatever card was open. The gate sees an approval recorded (`--approved`, inherited, or `draft
approve`) and a landing on a card naming a draft by id. A yes that names no draft — said in a relay about "that
message", or on a card whose doc or hand step is gone — binds nothing, so a relay carrying one is still acted on in
the pass that reads it ([routing](../../supervisor/reference/routing.md)). An ask's journal and a hand step are read as
they stood when the owner spoke; an ask's doc keeps no history, so the landing keeps the ids its card named as the owner's words landed
(`draftIds`, `landedCardDraftIds`) and a doc settled after the owner's yes still binds them. A card that would not read as the owner
spoke keeps why instead (`draftIdsUnread`), and that landing stays unreadable to the gate even once the card reads
again, until the card is restored. A landing written before those fields existed has only the doc as it stands. A `sent …` drop note is read back from Slack before the drop (above), but
a message edited or deleted between that read and the drop is not; a `not-owner-yes` hold's why is your statement of fact.
A false one ends the owner's yes exactly as a false hold would; neither is a path to use, and the register keeps both, so
either is findable afterwards.
