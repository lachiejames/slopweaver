# The voice says when a send did not go, never that it is done

The voice reads the owner a reply to a teammate, the owner says send it, and the voice must not answer "Got it" as if
it went. The as-me gates can hold such a reply as a draft (a person named untagged, an em-dash in the text), and then
nothing is sent and, without this rule, nothing tells the owner. The voice holds no send of its own: `relay_steer`
hands the owner's steer to the supervisor.

A send that went is not worth saying unasked: the owner has usually moved on to the next card, and being told it is
sent pulls their focus back for nothing. A send that failed or was held, or anything that needs the owner's attention,
is worth saying. So a send that went is never said unasked; a held or failed one is.

## An act the owner asks for is pending once relayed

Every `relay_steer` declares `outward`:

- `none` — the steer asks for nothing outside the call; a few words, then the next thing.
- `other-outward` — a merge, a post, anything nothing reports back; it says "On it", never that it is done, and never
  promises to tell the owner.
- `slack-send` with `sends`, the thread's Slack link read off the owner's screen or a tool, never composed; it says _"On it.
  I'll tell you if it doesn't go."_

The page refuses a relay with no `outward`, a `sends` beside anything but `slack-send`, or a `slack-send` whose link
is not a Slack message link (`relayOutwardOf`, `site/components/voice/talkToolRunArgs.ts`), and the hand-off note carries
the line to say (`handedOffAnswer`, `site/lib/relayAnswer.ts`). Every arm still forbids "sent", "done" or "handled",
and none adds that nothing has been done yet: the owner knows a relay is a hand-off.

## A Slack send is watched until it is sent, held or failed

`talk slack-send-outcome --url --since` (`src/talk/slackSendOutcome.ts`) answers from three sources, one rule each:
**sent** is the owner's first message in the live thread after the moment the owner asked, with its link, unless a
hold below is still waiting; **held** is an as-me draft parked for that thread since then and still held, with its
reason — it outranks a message of the owner's in the thread, which is then one the owner typed personally; **failed** is the newest line the send failure journal
(`ledgers/slack-send-failures.jsonl`, [the door](../security/slack-admit-door.md)) kept for that thread, unless a
hold is newer. `--since` is one ISO instant with its zone, to the millisecond (`parseStrictIsoInstantMs`,
`src/lib/date.ts`); anything `Date.parse` would guess at, `0` or a sub-millisecond fraction, is refused. Each is judged as an instant, and in a DM a top-level message, hold or failure counts as much as a
threaded one, since the owner answers there outside threads. A thread or register it could not read, one whose folder will
not open, or a register holding a line it cannot read (`draftsOrUnsure`, the journal's `JOURNAL_TORN`), is `could-not-check`, never "not sent
yet". A journal row, or any draft register event, whose instant is not strict counts as such a line, never as an old one,
and so does a line holding a byte that is not UTF-8: both reads are `strictUtf8`, never repaired.

A `slack-send` relay starts the page's watch (`site/lib/slackSendWatch.ts`): that verb read serially, waiting 5 s,
15 s, 30 s, then a minute, twenty reads at most, and none once the call it began on has ended or been replaced.

**A send that went ends the watch, said to nobody.** The call file gets `the Slack send is sent, and it is not said
unasked`, and the page's spoken-claim fold takes the read as grounding a "sent" the voice says later
(`voiceRecordWatcher`'s `landed`, `site/components/voice/voiceRecordWiring.ts`), within the newest four completed
messages as any grounding is. The owner can still ask, and `slack_send_outcome` answers.

**A held or failed send is told once.** The page posts only which send to `/api/talk/call/<id>/send-outcome`, which
reads the outcome again itself and hands a held or failed one to the live call once per send, as a developer message
whose words are the server's, the reason or error one line with its double quotes made single and quoted as data
(`PlanCall.announceSendOutcome`, `site/lib/talkPlanCall.ts`). So the voice is never told an outcome the page
asserted. A send the page read held that has gone by the server's read is refused with a 422 (`SENT_SINCE_REFUSAL`)
and never offered again. It is refused while anyone is talking or other speech holds the floor, and the page offers it
again every 3 s, forty times at most. A hand-over the session failed is never written again, since one that timed out
may have landed: a send is said at most once. The voice then says it in one sentence and goes back to where it was. A
second before it is handed over the page rings the **attention** chime (`sendOutcomeAnnouncement`), since a send that
did not go needs the owner's word. `PlanCall.announceSendOutcome` takes only a held or failed send, by type.

**Sent claims only what Slack shows**, when the owner asks. Slack shows a message of the owner's in that thread, never
which words, so `slack_send_outcome` answers that a message from the owner is there with the link on screen, never
that the send the owner asked for went out. A reply is still read against the registers, so a register that will not read makes it
`could-not-check`, never sent. **The journal holds a refusal, not the message.** A send
refused while it was still being prepared is journalled with a fixed sentence, because a malformed form's parser error
quotes the form. A refusal after that keeps its own words, which can quote a fragment a gate flagged — the residue.
The journal covers every `slack post|reply --as me` run that itself sent nothing: a missing user token, a retry held
back because an earlier attempt reserved the message and never confirmed it, and one an earlier send already posted.
A held draft the owner releases (`slack reply --draft`) that then sends nothing is journalled too, against the thread its held
row named when the release started (`heldReleaseTarget`, its first act, so a row dropped meanwhile still has one), since
it was parked before the owner asked and its hold alone would read as not sent yet. A throw is journalled too: in a release's gates by
`journalReleaseThrow` (`src/cli/commands/slack/sendFailureJournalling.ts`, every journalling helper), and in the send itself by `sendPreparedDrip`, for both paths.

**The residue.** A GPT-Live call holds no plan call, so it is told nothing unasked and its log says it is not watching;
the owner can still ask, and `slack_send_outcome` answers. The key is the thread and the instant, not the words, so
two of the owner's sends into one thread read as the first, and a message the owner types there personally before a
send that is not held lands reads as sent: the watch ends quietly, so a send that then fails is not told unasked, and
asked, the voice says a message from the owner is in the thread, which is true, and the screen shows which.
`--since` is this machine's clock, where the page and the server both run, and a message's time is Slack's: a clock
running behind Slack's by more than the gap between a message of the owner's and the owner's ask reads that message as after it. A call replaced while its `send-outcome` post is in flight can be told
on the old call, whose stream the page has already let go: that is an announcement lost, never a false one, and the
new call's `slack_send_outcome` still answers. A release whose row is not held at that first read (an unknown draft
id, one already spent or dropped), or any as-me send or release whose own arguments do not parse, names no thread to
journal against — an unparsed command's channel and thread are not trusted, so they are never scraped off argv — and
reads as not sent yet, never as sent. A `--dry-run` is a preview rather than a send, so it journals nothing: a row
would read as failed while the real send may still follow. So does a refusal whose journal line could not be written: the send says so on stderr and
keeps its own exit code, and an absent journal reads as empty. The link names a thread, so a top-level post into a
channel that is not a DM is outside the read: it is journalled, but whether it landed or failed reads as not sent
yet — never as sent. Counting every top-level failure in the channel would pin another post's failure on this send. A send aimed at a
channel typed by name and refused before the name resolved is journalled under that name and matched on its thread
root alone; a top-level one, in a DM named that way, names no thread and reads as not sent yet.
