# Where a draft goes for the owner's eyes

Two of the owner's rules disagreed about this for nine days, and a third narrowed one of them. This file is the resolution, plus the one case it does NOT settle.

## The axis is what the draft is FOR, not which surface is nicer

| The draft is…                                                            | Where it goes                                                                           | Why that one                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| a message to a person that **nobody asked for**                          | parked with `slack draft record`, on the owner's console queue for the owner's yes      | the owner's ruling: it should probably be on the queue page                   |
| awaiting the owner's **approval to send**, a preview the owner asked for | the owner's private bot DM, as REAL Slack messages in the exact shape they would go out | a render tells the owner the EFFECT; a preview only tells the owner the words |
| offered for the owner's **reaction or steer** inside a briefing          | inline in the briefing card's own fold                                                  | the card exists to remove a layer of indirection, not to add one              |
| one the owner already **said yes to**, on a call or anywhere             | nowhere: it is SENT, the owner's typing fixed without asking (`--approved <anchor>`)    | the owner's ruling: [pre-approved](pre-approved.md)                           |

**None is ever a file path, a terminal preview, or a bare artifact link the owner has to open in another program.** That is
the half every ruling here already agreed on, and the part to hold onto if you are ever unsure which column you are in. Whichever column, the draft names who will see it, and a reply under a bot alert tagging nobody is not a shape ([who-will-see-it](who-will-see-it.md)). A channel the owner names for a held draft moves it, and a release into the old one is refused ([channel-steer](channel-steer.md)).

## The rulings, and what each one covers

- **The fold ruling.** A proposal or discussion piece raised in Slack is ONE top-level message posted as the
  owner, never several top-level drips; and a draft for the owner's reaction lives inline in the
  fleet-briefing card's fold, never as a file path the owner has to open. The rejected alternative there was
  **the file path**.
- **The DM ruling** (the archived state repo's own rule, ported here). A draft that needs the owner's approval
  goes to the owner's private bot DM as real Slack messages, drip-fed as a series, posted AS THE OWNER when
  the send is as the owner; explicitly NOT the terminal and NOT an artifact. The rejected alternatives there
  were **the terminal and the artifact**.

They were read as contradictory because both sentences contain the words "a draft for". They are not: one is
about a draft the owner is being asked to REACT to, the other about one the owner is being asked to APPROVE, and
each names a different rejected alternative. A later ruling narrowed the DM route to a draft the owner ASKED for: a message to a person nobody asked for is parked on the owner's queue, and its queue card shows it whole.

## What is still the owner's to rule on

**An UNASKED team announcement is settled by the first row**: it is parked with `slack draft record` as ONE
top-level message, and its queue card shows the full text inline — the queue card is the fold, so the
decision is readable where the owner is and the destination's shape is kept.

**The overlap the owner asked for.** An announcement the owner asked the fleet to write can be both at once: a
discussion piece the owner may want to steer, AND a concrete send waiting on the owner's approval. No ruling covers that
case, and two properties genuinely collide in it — the DM route says drip-feed as a series, while a
public-channel destination is ONE top-level message, so a faithful render of the destination and a faithful
drip cannot both happen. Until the owner rules: put the full text inline in the card's fold, and say in the
fold that the send is awaiting the owner's word. Do not silently pick the DM series for something bound for a
public channel — the destination's shape wins over the drip habit, because the render is the thing the DM
route exists to show the owner.

## The rules the approval route carries, unchanged

- **The private bot DM, never the public bot channel.** Resolve the conversation id from this installation's
  own configuration; a draft posted in the public channel is a leak of an unsent team message, not a draft.
- **As the owner when the send is as the owner; as the bot for bot-voiced content.** Seeing bot-authored words
  under the owner's name reads wrong to the owner, and so does the owner's name on a finding the bot found (the
  section above).
- **A thread reply gets an anchor.** Post an anchor message linking the target thread first, then drip the
  draft as replies to that anchor, with enough brief that the owner is across the conversation before
  answering.
- **No invented stance.** If the owner has not spoken in the target thread, the draft takes no side: a room
  reaching a conclusion is evidence about the room, not about the owner. If a draft needs a stance to work,
  hand the owner the fork instead.
- **A message to a person is never an unasked send.** In the owner's ruling, a review ask, a chase, a bump or
  a DM as the owner that nobody asked for is parked on the owner's queue until the owner approves the pattern
  ([rule 10](../../../docs/doctrine-rationale/rule-10.md)). A reply where someone asked
  the bot is not this, and neither is a post to the owner's own bot DM.

## A message as the owner to the bot is sent, never parked

A queue card holding a reply as the owner under the owner's own message to the bot is slopweaver dogfooding, and
it should never be escalated to the owner or blocked on the owner. So the seat that needs one — a gold witness's human half, above all — sends it with `slack post|reply --as me`, and
`slack draft record` REFUSES to park it, naming that command. The test is exact
(`src/outbound/slack/botDmWitness.ts`): the destination is `slackBot.promptChannel`, and the message is top-level
or replies under a root THE OWNER wrote. A reply under the bot's own root there, the owner's self-DM (their `U…`
id under their token) and any DM with a person park as before. No hatch: the direct send is the path.

## A colleague named in the prose is tagged

A card where one name drew as an identity chip and the other as plain words showed the need for a gate on Slack
messages. So `slack draft record --as me` REFUSES a
message whose authored prose names a colleague it does not tag, naming each spelling, who it is and the exact
`{"type":"mention","person":"U…"}` run to use (`src/outbound/slack/untaggedNames.ts`). A name is what the queue card
chips — a whole name theirs alone, or a first name nobody else goes by — matched in ANY case, since the owner's voice
is lowercase. A person the message also tags, the author and a DM's other member pass. The residue: a unique first name
that is also a word (`ray`, `rob`) is held too and reworded. No hatch: tagging them, or not naming them, is always available.

## A finding shared in a channel is the bot's draft

A finding shared at the top level of a channel after the owner approved the queue card posts as the bot instead
of as-me, because the bot found it and the owner has not verified it. So `slack draft record --as bot --form -` parks a `finding` card (or any bot form) for a team channel: the same
admission, render, three-picture floor and membership check a `slack post --as bot` runs, with the bot's own
id as the author the digest binds. `slack post --as bot --draft <id> --approve <digest>` releases it through
the whole card lane, refusing if the card now renders differently; each verb refuses a row recorded under the
other identity (`DRAFT_ACTOR_MISMATCH`).

**As the owner only where the bot cannot post**: a DM with a person, a reply in a thread the owner is already in (a person's, never a bot alert's), or a
private channel the bot is not in. `slack draft record --as me` of a top-level finding refuses in a public channel
(the bot token's `chat:write.public` posts there unjoined); in a private one it asks Slack under the bot's token
and parks only on `not-member`, recording `botCannotPost` on the row, and a read that cannot say refuses; the release
reads it again, so a bot invited since refuses it. A top-level row as the owner outside a DM MUST declare `--kind
finding|message` (a review ask or announcement is `message`), and one held with no kind is held as a finding
(`src/outbound/slack/findingIdentity.ts`). A held as-me row of that shape is NOT SENDABLE: `draft show` and the queue
card print the re-record, and the release refuses it (`DRAFT_FINDING_IDENTITY`). The re-record names `--supersedes
<id>`, so the as-me row is dropped as the bot's cut parks: a bot release spends only its own author's cuts. No hatch.

## A draft that replies in a thread

`slack draft record --thread-ts <root ts>` parks a THREAD reply: it reads the root first (a ts naming no
message, or a reply rather than the root, parks nothing), keeps the root's author, text and permalink for the
card (the permalink only for a `C`/`G`/`D` channel and outside the digest; the card links the thread with it), and
binds the thread into the digest. `slack reply --as me --draft <id> --approve <digest>` releases it; `slack
post --draft` REFUSES a thread row, and both verbs refuse a top-level row whose `--why` says thread reply —
re-record that one with `--thread-ts` and drop the old row. A `--why` saying thread reply with no
`--thread-ts` is refused at record. Two drafts were once
parked top-level with a why reading THREAD REPLY, released by `slack post`, and landed top-level in
two channels under the owner's name. `slack draft show` and the queue card name the parent.
**A `--why` names a call by what it was, never its id**: `record` (and `--meaning-changed`) and `hold` refuse a raw session, call, talk, turn or run id (`machineIdProblems`), since the card prints it and is held off the owner's Queue for it, and a card once opened blank that way. Write "the owner's call this morning".

**One thread's replies are ONE card.** A seat once parked five replies to one thread as five cards; they need to
be merged into a single queue card, in the owner's voice, since the order they land in is unknown. So a reply into a thread that
already holds one under the same identity is REFUSED before any Slack read, naming every held reply there: read
each with `slack draft show`, compose ONE reply in the owner's voice covering all of them and the new point, and record
it with `--supersedes <id>,<id>,…` naming every one, which drops them as it parks
(`src/outbound/slack/draftSameThread.ts`). A reply as the owner and one as the bot stay separate, since one post
cannot carry both names. No hatch: the merged re-cut is always available.

## What a draft does: `--act`

`slack draft record --act reply|bump|review-ask` records what the message DOES, and the queue card draws it as a
badge before the title — Reply, Bump, Review ask — with the people it is to as chips by member id and one plain
context line under it. A row recorded without `--act` draws no badge, since no
badge is never a wrong one; the card never guesses one from the `--why`. `question` is refused: a question is
what an ask row puts to THE OWNER, never a message the owner sends. The act rides outside the digest, so it names what
the owner's yes is for without changing the bytes it binds. A draft that ASKS declares `--asked-before none|<our earlier message>`, and an answered one parks only with the change shown in pictures, bound into the digest: [asked-before](asked-before.md). A `bump` or `review-ask` on a closed or merged pull request never parks: [settled-chase](settled-chase.md).

`--row <slug>` names the board row that raised the draft, and the card shows that row's tags as pills under
"Read from", each linking to the Queue filtered by it. A slug no handover doc holds, live or archived, is refused
naming the file it looked for. Like the act it rides outside the digest. A card with no workstream says so in a
dashed pill rather than drawing a short list as whole.

## The conversation a draft lands in

`slack draft context <id> [--json]` reads, LIVE through the door, what the draft would land in: a thread
reply's whole thread, or a top-level post's last six channel messages, with each author named and a link to
open it in Slack. It reads the corpus never and writes nothing. The queue card draws it above a HELD draft, the
draft framed amber as not sent (a draft drawn alone made the owner open Slack to see what came before it). A DM addressed by member id has no conversation to read (`DRAFT_CONTEXT_NO_CONVERSATION`, exit 3);
an unreadable one is `DRAFT_CONTEXT_UNREADABLE`, and the card says NOT MEASURED and draws the draft alone. Its `--json` (schema 2) carries `sinceDrafted`, what was added, edited or removed since the row was recorded as the release would classify it plus what the read could not see, folded behind one quiet line on the card ([fidelity](../../../docs/console/slack-draft-fidelity.md)). What the owner changed on a draft afterwards is `slack draft corrections` ([draft-corrections](draft-corrections.md)); Codex's draft beside a new one, and the owner's pick, is [draft-comparison](draft-comparison.md).

## A draft with an attachment

`slack draft record --media a.mp4[,b.png]` admits every file the way `slack post --media` does
([media.md](media.md)), keeps the admitted bytes in the owner-only draft-media store, and only then parks
the row — a refused or unstorable file parks nothing. The digest binds each attachment's name, byte count
and SHA-256 in order, so **adding, swapping or reordering a file is a new draft with a new digest**: re-record
it and read the new one. A text-only row digests exactly as it always did, so no earlier approval moved.

The release (`slack post|reply --as me --draft <id> --approve <digest>`) reads each blob once and verifies it
before anything is prepared; a blob that is gone or no longer hashes to the row refuses with
`DRAFT_MEDIA_UNAVAILABLE` and nothing is sent — re-record from the original file. `--dry-run` verifies too,
and names each attachment with its size and hash. `slack draft show` lists them; the console card draws each
picture inline, as Slack will.

`record` refuses what the card could not draw as Slack will (`src/outbound/slack/draftFidelity.ts`): a bare citation marker like `[2]`, `[1, 2]` or `[^1]` in prose — write the source as a link whose
label is the words a reader clicks; code is left alone — a TIFF, which no browser draws inline, text that
merely opens with a picture's or video's first bytes, and an attachment whose extension does not name what its
bytes are; attach a PNG or JPEG under its own extension. **Nothing deletes a blob yet**: identical bytes are held once and may back several drafts, so they outlive
release and drop until a sweep that locks both the register and the store exists.

## A line the register cannot read

Nothing refuses the whole register. `list`, `show` and `drop` pass over every line this version cannot read — an
event kind it does not know, a draft shape it does not write, or a line that is not JSON — and say so on stderr,
naming each line and the draft it names (a line that is not JSON names the one draft id it still carries), so
every other draft still shows (`parseSlackDraftLog`, `src/outbound/slack/draftRegister.ts`). A draft such a line names is left out of the rows, since that line may have
spent it. A release refuses when a passed-over line names that draft or names no draft at all, and so does
`handover ask` naming one. Never edit the file by hand to clear a line.

## A draft is ready to show the owner only when it carries its proof

A claim is never made without evidence, golden proof: screenshots and citations come with it. So before a reply to a teammate is
offered at all, it passes `slack voice-rules` and the render gates, and every claim carries its proof in the
message: a screenshot (`browser shot`, via `--media`), the query verbatim, the command and output behind a repo
claim, a link to the source. `slack draft record` refuses one with no link or file unless it says why
(`--self-evident`) or what it tried (`--tried`) ([receipts](receipts.md)).

## A message to a colleague borrows the owner's name

Its whole value is borrowed from the owner, so an ask that is not obviously what the owner would send trains the
reader to filter the next one. Ask a colleague **as the owner**: people reply conversationally, and a
conversation with the bot is one the owner cannot see. Offer the owner a choice only where it is real — bump
this reviewer or ask another who satisfies the ownership rules — never a card the owner would always answer the same
way. A chase is one line, the ask and the link, and any fact it is gated on ("it's green") is restated plainly in the same message rather than
trusted from an earlier report. A cadence is not a rate limit: a quiet day earns a bump, parked like any
unasked message, never a counter that refuses one.

The message shape itself is [voice-gates.md](voice-gates.md) and `slopweaver slack voice-rules`; a parked one is
capped at record by [earns-its-place.md](earns-its-place.md), and one for another team is [enablement](enablement.md).
