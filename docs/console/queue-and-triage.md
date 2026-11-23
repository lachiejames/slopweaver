# `content/console/queue.mdx` — what is waiting on the owner's word, and the acts

Part of [The console, the board, and the session ledger](../console.md).

**The page opens on one bar and then the cards** (nothing that once sat above _Blocking a colleague_ earned its
place): the view selector, any tag a link carries, and the freshness line — [the selector](./queue-tag-filter.md).
No page head, Now line, workstream band or count chips sit above the list, and **the page ends at its last card**,
with nothing underneath it. A steer that came back puts its card back and says nothing;
why is the chair's to read (`talk unread`, `src/supervisor/unpickedSteerGate.ts`). The console's only text input is the
call's chat — the owner wants no text inputs, the call's transcript being the one way words enter the app — bar a hand
step's secret paste; `site/__tests__/unit/textInputs.test.ts` refuses any other.

**A reload never blanks the cards.** The desktop shell brings its window forward without reloading the page it has
committed to (`loadsOnShow`, `desktop/src/surface.ts`), a hidden tab resumes on each channel's own next tick rather
than a burst of re-reads (`holdQuiet`, `components/live/useLive.ts`), and each of the six registers keeps its last
ready reading over a failed poll, as every live read does — never across a press's loading (`liveStateAfter`,
`site/lib/liveState.ts`) — while the freshness line's staleness mark names the register drawing an earlier reading and
why. `readCount` and `missing` stay on the latest reads (`latestReadOf`), so the sidebar badge never calls a kept register current; the view counts read `allDrawn`,
the cards on screen. A card BUILT from any kept reading opens with every press held and says so, "an earlier reading"
(`QueueReading.kept`): a press never acts on what the failed poll could not confirm. A kept board holds every card, since each takes its tags from it; kept hands hold the asks too, since a
hand step absorbing an ask decides whether it stands. The hold rides `PressHold`
(`components/console/press.tsx`), which `usePress` itself reads, so a child button that never learned of `gone` —
a mail preview's — refuses too, and so does every press on a snapshot of a card that left the list. Any main-frame
load failure, an aborted one included, clears the shell's committed path, so the next show reloads.

`components/console/Queue.tsx`: six registers in one rounded card, drawn in three sections by the one ranking every surface of what waits on the owner shares (`src/waiting/rank.ts`, mirrored in `site/lib/waitingRank.ts` under a drift test) — **Blocking a colleague** (a row that places in work, a held reply, a post as you, a landing verdict on an organisation PR), **Blocking the fleet**, then **Check-ins — your word is a review** (any hand step posted `--check-in`, and an ask that looks answered already), the last shown apart from the sidebar badge, because the blocking sections are where the owner expects to be led first — every row stamped with when it was last confirmed and _may need review_ past six hours (`site/lib/queueFreshness.ts`), and the two send-bound kinds with the message's own opening under the question — hands (`hand list --json`, fast lane,
oldest first), asks (the `handover list --json` rows whose `ownerWait` kind says they wait on the owner, longest-waiting question
first — see below, read once), held
replies (every `queue list --json` item whose state is `held` — a reply a session drafted and the door is
holding for the owner's word, 2.23s wall MEASURED with `time slopweaver queue list --json`), posts as you
(`slack draft list --json`, fast lane — a message a session composed under THE OWNER'S OWN name and parked, which
nothing on the page can send), reviews as you (`github review-draft list --json`, fast lane — a review of a colleague's pull
request parked as draft line comments, which nothing on the page can post), judgment (the tick's last `github landing` reading: rows waiting only on the owner's word naming a reviewer first,
except one dispatched `draft-first-review-ask`, whose seat's recorded ask or discussion opener is its one card, then rows whose dispatch
verdict is the verb's own that the row needs the owner's judgment). The autonomy ledger's acts are not a register here: `site/lib/alignment.ts`
partitions every `act` row to the [Alignment page](./alignment.md), and `useQueueRows` returns the Queue's side as `rows`,
which the view counts, the sidebar badge, the voice's triage pass and its `action_items` all read; every count the page or
the voice says comes from one projection of it, `queueShownOf` ([why](./voice-holds-to-the-record.md)). Each register shows eight
rows then one row saying how many more it holds; the freshness line is a staleness mark whose hover names every
register that could not be read or is drawing an earlier reading, with its reason and the age of what is drawn. Inside a section the rows draw in one ranked order across registers, fresh cards first whatever their kind, each register's fold after its last drawn row (`site/lib/queueLayout.ts`): the rank is the latest recorded `handover currency` reading — the tick's, or the one opening the Queue takes when the reading shown is ten minutes old or missing (`site/components/console/useCurrencyOpeningRefresh.ts`) — one schema-3 row per card of every kind joined by its exact key and the instant it reached the owner, and a card the owner has since filed a word to moves to the check-ins (`site/lib/cardCurrencyMark.ts`, the mark in `site/content/console/queue.mdx`). That reading unread is one of the registers the staleness mark names. Ahead of the tiers, every list opens in one order, the same on the page, in the voice and in a triage pass: **Blocking your priorities**, **Your priorities** (ranked by priority, board band, then the controls each resolves), then **Stopped automations**. A blocker or a stopped automation stays in place when put off, with its decision and options on its face ([the owner's priorities](./queue-focus.md)). Every row carries the provenance glyph before its question — every card wears the glyph
of the workspace its placement draws it in (`queueProvenanceOf`), and a pull request the same bar a review bot's thread
waiting on us or a bot-review fix next ([the rule above](pull-requests.md)) — and no other label: no kind tile, act badge, pill or placement tag, since the
question already says each, and a row stacking kind, register, count and label reads as too much. A row opens the archived console's slide-over, ported: right-anchored,
`min(85vw, 1100px)`, a fleet-briefing card (`QueueCardBody.tsx`, derived by `site/lib/queueCard.ts`; an ask draws no
`why you` or `if silent`, lines the owner's words never reacted to) with the
record's own fields folded beneath it as labelled lines (`RecordLines.tsx`), and a footer carrying the acts above — the hand panel's Mark done, which records the fixed words printed on it (`HAND_DONE_WORDS`, "done, marked on the console"), and its three Not now answers (1 hour, 3 hours, Tomorrow — `hand snooze`, never a bare dismiss); a hand step that stores a secret also draws one paste field per name (`SecretFields.tsx`, [pasting a secret](../../skills/hand/reference/pasting-a-secret.md)), under the provider page with a numbered red box per thing to grab when posted with `--shot` (`HandShot.tsx`, [showing the page](../../skills/hand/reference/showing-the-page.md)); the ask panel says `handover answer` is gated on the writer session and the pull request panel says why enqueue is owed. **A card whose fields are still arriving draws one loading state and nothing else** (`cardLoading`,
`site/lib/cardLoading.ts`, drawn by `LoadingPanel.tsx`): its kind, a skeleton and a spinner whose hover names what it reads — a hand
step while the ask it opens is unread, a card naming a draft the drafts register has not answered, and a card left open after its row went while
the register it came from has no answer (`ownRegisterWait`) — never a heading off a half-read record, an absence
sentence or a button acting on half the facts. A register that could not be read is not loading, and the card draws
a staleness mark whose hover says why, unless the register already answered: its last reading stays drawn, marked stale, for every page alike (`liveStateAfter`, `site/lib/liveState.ts`). Cards whose drafts turned into an error read as
broken, and a card opened fresh looked bad for ten to fifteen seconds first. `?open=<kind>:<id>` deep-links a row, and a click opens or closes a panel by rewriting that
address with `history.replaceState` (`useOpenedRow`, `site/components/console/useQueueRowsOpen.ts`), never a router
navigation: in a tab loaded before a rebuild, a router navigation fetched the page under the new build id and became
a document reload, which a live call's hold parks until hang-up, so clicks did nothing in the tab carrying the
call. A row that leaves the list while its panel is
open stays drawn — a steer collapsing it, a seat taking it or its row settling elsewhere never closes it; only the owner's
close does — with a plain "This card has left your queue" line at its head
(`DepartureIndicator`, `site/components/console/CardDepartureNote.tsx`; never a pill) and "since you opened this" naming who took it from the
readings the page filtered by (`site/lib/cardDeparture.ts`): the owner's words and which landing put them there (never the
landing of a steer that came back, and still after the row settles), the newest steer hiding it, the newest relay
no session picked up when only those hold it, an act the
Alignment page draws, a board placement still pending, a register drawn from an earlier reading; a row no register
holds and no reading names keeps its register's word. The live and gone panel are one element tree, so leaving the
list never remounts it. A deep link or reload onto a card the owner's words already took off draws that same panel, never
"the work context hides it", and the voice reads it as the open card (`panelRow`). **A
hand step opening a shaped ask is one decision row** (`linkedHandDecision`, `site/lib/handStepAsk.ts`): its card
draws the ask's problem, options with trade-offs, lean and stakes, its panel the ask's doc, pull requests and
thread, and the ask draws no row of its own — unless the ask is a workspace finding, or the two would be drawn in different workspace views, when the ask keeps its
own row where its placement draws it (`handAbsorbsAsk`, `site/lib/registerPlacement.ts`);
`?open=ask:<slug>` opens an absorbing hand row as an
alias, an exact key first (`site/lib/queueOpen.ts`), so a hand step never leaves the owner unsure what is being asked
with nowhere to go for more context. **A
linked row placed in the other workspace switches the console to that row's context and opens it**
(`contextToOpen`, `site/lib/workspacePlacementContext.ts`; a finding is drawn in Slopweaver's, so a link to one opens there), never onto the wrong context with "the work context you are in hides it", as a
floating note once opened a `self` row onto the team's. `hand post --open <kind>:<id> --context <ctx>` mints the link
with `&context=` already on it (`src/hand/consoleLink.ts`), so it paints in the right context first time.
The card's stakes rows — **risk**, **blast radius** and **still real?**, the last saying "you raised this on a
console call 2.4d ago; the fleet last checked it 3.0h ago" (`site/lib/stillRealLead.ts`) — are the ask's own `--risk`, `--blast-radius` and `--still-real` lines from
`handover ask|offer|register`, drawn only when all three are there; an ask recorded without them says so and
how to re-ask, and a row from any other register says only a recorded ask states them. **A hand step's
`--literal` is drawn whole under WHAT as a `paste` row with a copy button** (`StepCard.copy`), on a step to take
and a decision alike (a non-string one is refused), and `read_page` carries it as `paste`, since a card saying "Paste this in a terminal…" with nothing to copy is a dead end. **Every command is its own copy block above the fold, reading `copied ✓`** (`CopyBlock.tsx`): a `--checklist` step draws lines the owner ticks,
each naming where its value sits, and an ask's command paragraph lifts into `BriefingCard.commands` ([checklist](../../skills/hand/reference/checklist.md)). **The place a step sends the owner is its FIRST row, `go to`, always a citation chip** (`stepDestination`, `site/lib/handCard.ts`): the page the fleet `opened`, else its link unless that link is this very card, else its one cite — and its own card's link is not drawn beside it, so a sign-in card never loses the clickable link to the page it opened.

**Every `sd-` draft a card names is drawn on the card itself**, in its draft slot above the options — an ask's
or a hand step's own texts, resolved against `slack draft list --json` (`namedDrafts`, `site/lib/slackDraftIds.ts`;
`NamedDrafts.tsx`): a held one with its send line and "No media attached." or how many it binds, a sent one stamped so, a dropped one FOLDED behind its drop note under its LIVE re-cut when one exists (`liveCutOf`), and an id the register lacks as a warning, never an empty slot. A held reply's thread and a posts-as-you draft
sit in that same slot. A card asking the owner to react to a Slack draft that it does not show must never happen;
the verbs that refuse such a
card are [named-drafts](../../skills/handover/reference/named-drafts.md).

**A card a gate refused is held off the Queue, never drawn as its refusal** ([why](../../site/content/console/queue.mdx)): `partitionQueueRows` (`site/lib/queueWithholding.ts`, in `useQueueRows` and `actionItemProjection` alike) takes a refused non-act row out of `every` — no list, count, badge, triage walk, spoken item or recently-left card — leaving one counting line, `WithheldPanel` on `?open=`, and `GET /api/queue-refusals` for `slopweaver queue refusals --json` (`src/queueRefusals/`), which the supervisor tick reads.

**The as-you register draws Slack, not a card.** `components/console/SlackDraft.tsx` renders a parked draft's
own `rich_text` blocks the way Slack renders them — the bullet list, the typed runs, the resolved `<@U…>`
mentions — because the thing the owner is judging is the message, and a paraphrase of it is a different message.
Nothing on the page can send one; the panel carries the two commands `slack draft record` printed, and the recorder
prints that panel's own address: `http://localhost:3000`, or `SLOPWEAVER_CONSOLE_URL` when a second checkout holds
that port (`src/cli/commands/slack/draftWiring.ts`). The send command the card prints is the row's own `release`
(`draftRelease`, `src/cli/commands/slack/draftReport.ts`), never a verb the console picks: `slack post --as me|bot
--draft <id> --approve <digest>` for a top-level row, `slack reply` for a thread row (its card names the parent), and
a re-record for a top-level row whose why says thread reply or a finding parked as the owner in a channel,
which both verbs refuse. It re-prepares the form through every live gate, refuses unless it digests to the approved
one, needs no untagged-bump hatch for a DM, and marks a landed send released (`releaseRun.ts`). A re-ask draws our
earlier message, their answer and the changed charts above it ([asked-before](../../skills/slack/reference/asked-before.md)). Its what leads with the receipts line (`site/lib/postHead.ts`) ([receipts](../../skills/slack/reference/receipts.md)).

**The voice edits the open draft live, and never sends it.** While it works, `components/console/DraftEditFrame.tsx` puts a moving border round the message, quotes the owner's words and lists the voice's reading of them as a checklist, held for the call only (`components/voice/draftEditRun.ts`). Once saved, the card reads `v2 · v1 kept`, the earlier versions behind a disclosure (`components/live/readDraftVersions.ts`), and "put it back" restores one as the next version ([draft-revisions](../../skills/slack/reference/draft-revisions.md), [the boundary](../security/voice-boundary.md#the-one-draft-write)).

**Pixel-faithful to Slack, in its live conversation.** The draft is drawn as Slack draws it, below the thread or channel it lands in: the owner's avatar, the header, inline pictures, Linear previews. One quiet line says what changed there since it was drafted. `slack draft record` refuses what the card could not draw ([slack-draft-fidelity](./slack-draft-fidelity.md)).

**A draft names people, never Slack ids**, because a draft reading `you (U0SYN000001)` leaves the owner unable to
tell who the id is, or whether it posts as them or as the bot. So `slack draft list --json`
carries a `people` roster beside its items — every author, DM recipient addressed by member id, tagged person
and `<@U…>` in the listed drafts, named off member bronze (`src/corpus/members/slackPeople.ts`), read only when a
draft carries an id — and the page draws names from it (`site/lib/slackPeople.ts`): the message is signed with the owner's name and face, each
mention chip and the tags line name the person, and the id is always the hover. The queue card header and the
drawer's channel line say who and where together (`draftDestination`), a name and a channel in place of a user id: _Post this to Kyle in a direct
message as you?_, or _to Ari in #eng_, a channel post being to the people it tags. A `D…` conversation id reads
only _a direct message_, since nothing the list carries says with whom. An id the roster cannot name is drawn as
the id, never a guessed name. A bot row (a channel finding) is signed the bot, APP badge, asking _…as the bot?_. Outside the draft, a sentence names a person by first name and the owner as "you", the identity chips with hover cards are the card's properties, and a thread reply links its thread: [identity chips](./identity-chips.md).

**The drawer's heading is the ASK, and nothing behind its fold is the record's own body.** A drawer titled
"Recorded ask" leaves the owner unable to tell what is being asked of them: a heading that is the
register's word for itself asks nothing. It is the one-sentence question, with the register, the subject and the age
on the line under it (`site/lib/drawerHead.ts`) — the pairing
`skills/supervisor/reference/fleet-briefing-shape.md` § "Card shape" already specified and the drawer had
inverted. The owner's second reaction to that drawer was that opening "the rest of what the record says" was a wall of
text; the cause is that a board row's `reason` EMBEDS its whole `question` (`src/handover/boardEvidence.ts`,
correct for the board's own one-line rows), so the card printed the same paragraph twice. MEASURED on
`slopweaver handover list --json`: **38 of the 43** rows carrying a question have the whole question inside
their own reason; the questions run 448–1,562 characters and their lead sentences 29–221, with nothing in
between. `reasonBeyondQuestion` (`site/lib/queueCardAsk.ts`) subtracts the question from the reason and draws
what is left — four words on most rows, and the pre-approved-stop line where the board wrote one — so a
reason that says something new is never dropped. The fold is not the record's body at all: `recordLine`
(`site/lib/recordLines.ts`) turns each field into a labelled line, and **folds one past 240 characters**: its
whole leading sentences that fit, or the words of a first sentence that fit, are drawn, and the whole field only
after **show all N characters**. A notice in the field's place, saying it exceeds a limit and will not show
properly, reads to the owner as a bug. A page the owner chose to expand shows the owner the content; only an outbound form refuses.
EVERY constructor measures, including the one that draws a link: a review found `recordLink` passing its
label through unmeasured, which `subjectLabel`'s fallthrough could have made unbounded, and the address stays
whole because an address is one click.
The cap is the schema, not the renderer's restraint (`AGENTS.md` rule 7): nothing past it reaches the page
unasked. Proof is `site/__tests__/unit/recordLines.test.ts`, which asserts every folded head is inside the cap and
every whole is the field entire.

**Every card link is a `CitationChip`, and a local page opens through the console.** A page link on a card must
click and Command-click, never need copying and pasting, and a raw one cannot, because Chrome refuses a `file://` link from an `http://` page. The chip keeps the record's `file://` address in
its hover card and links `/api/page/<slug>/index.html` (`site/lib/localPageHref.ts`), which serves the page out of the
store's Storage under a sandboxed origin (`site/lib/localPageServe.ts`, [published pages](../store/published-pages.md)) and opens in a new tab. A page
named in ANY field a card draws (problem, lean, an option, a stake) is that chip inline, labelled by its slug
(`site/lib/inlineCitations.ts`), never plain text. Every briefing the voice reads through a card is a chip on it, off one resolution for both
([citations](citations.md#every-briefing-the-voice-reads-is-a-chip)).

**An ask about a MESSAGE draws the message, Slack-native, and every ask links its own work.** The owner reacts to a
written-out draft in a Slack-native preview of how it would look posted into its channel or thread, in a slide-over,
with holding it for now as one of the options. A row whose
`handover list --json` carries an `action` (`handover ask --action`, `handover offer` —
[ask-shape.md](../../skills/handover/reference/ask-shape.md)) draws `SlackActionPreview.tsx` at the top of
`QueueCardBody`'s `preview` slot: the destination, the sender slot, the mention chips and the body as the
channel would render it, each `followUps` part its own message. The options under it are the destinations,
derived by the verb and re-derived by the decoder, with HOLD last, and each carries the command a session or
the owner would run — **nothing on the preview sends** (`site/lib/actVerbs.ts` carries why a provider-reaching verb
is not a button until its own dry-run is in front of the owner). Every Slack surface a card draws wears Slack's DARK
palette in every look, Daylight included, since the owner's Slack is dark (`slackSurfaceBlock` in
`site/lib/theme.ts`), and a channel chip reads `#name`, id on hover (`site/lib/slackChannelLabels.ts`).

Four properties are the rule rather than notes. **A destination that will not read invalidates the whole action**,
so the card draws the defect instead of the draft (`readAction.ts`): keeping the survivors would offer the owner two
places to send a message the row says goes to three, with a card that reads exactly as complete either way (found
in review, with a `thread` destination carrying no `threadTs`). The verb reaches the same verdict a step earlier
and publishes it as `actionUnreadable` rather than as a missing `action`, which would be indistinguishable from an
ask that never offered a draft: the row then carries no options — not even the ones the doc's front matter
authored — and the card names the defect instead of drawing "this ask offers no draft" over a real one. **Any row
that offered a draft loses that fallback, readable or not**, because the doc's front matter was written before the
draft existed and a readable action whose journal line carries no `lean` reaches the same wrong card. What such a
row publishes instead is derived from the action itself, so the options are its destinations even when the line
recorded no shape at all. The preview **composes nothing**: every string is a field the verb recorded or a
constant belonging to the page (`AGENTS.md` rule 2), so the sender reads "You" because the action records
`actor: "me"` and no register on the page holds the owner's Slack display name. `site/lib/slackMrkdwn.ts` returns typed
SPANS and each becomes a React element — a draft is prose about an incident and may contain anything, so it can
never reach the DOM as markup. And an ask carrying no action draws **no preview at all** rather than an empty
frame, because most asks are a decision about work rather than about a message.

**An ask about an EMAIL draws the email, mail-native, and has its own page.** The owner's ruling (option A): a
mail-native draft preview on the queue, the Gmail draft created only when the owner presses. A row whose action is a
MAIL ([ask-shape.md](../../skills/handover/reference/ask-shape.md)) draws `MailActionPreview.tsx` in the same
slot: From, To, Cc, Bcc, the subject and the first lines of the body as plain text, then the address of
`/queue/mail/<slug>/<digest>`, the page that draws the whole mail. That address is the row's published
`mailPreview.url`, so the card and the page name one mail. A superseded address SAYS it is superseded rather
than quietly showing the new mail, because the press would refuse its digest anyway (`site/lib/mailPreview.ts`).
Two presses sit under it: a dry run, then create, enabled only by a clean dry run; both are
`gmail draft --board <slug> --expect <digest>` rows in `site/lib/actVerbs.ts`, carrying the slug and the digest
and never the mail. Nothing on it sends.

Every card names its pull requests and tickets INLINE, whichever register it came from: in the heading, the
subtitle's subject and every field of the body, `#N (https://…/pull/N)` and `https://…/pull/N (#N)` read `#N`, the number the
link; a bare pull-request address reads as its number, a Linear issue address as its key, in any case, so a lower-case `exa-2` links through it too (two addresses differing only by case are one) (a comment's `#comment-…` and a query, `?notification_referrer_id=16406`, kept on the chip, a number inside it naming nothing), and
`owner/repo#N` links as written, `issue owner/repo#N` to that issue (`inlineSegments`, `site/lib/inlineCitations.ts`, drawn by `InlineText.tsx`).
A reference is a hoverable number, a citation at most — never a raw URL in brackets after it, never
a chip row at the bottom of the card — and every pull request number and ticket number is a real citation chip,
never plain text such as a hand card heading reading `Open acme-admin <number>:`. So a bare
`#N`, `#N/#M`, `PR N`, `PR#N`, `PR-N` (a Linear key instead when the install has a team `PR`), `acme-admin N`, `acme-admin#N`, `acme-admin PR N`, `EEEE-840` or a number standing alone, `keep 17344`, links too — each only when an address the row carries names
exactly that pull request or ticket (a number standing alone also has to read as one of that repository's, below) (`cardAddresses`, `site/lib/cardAddresses.ts`: an ask's `prUrls` and its address `anchor`, a hand
step's `url`, `where` and `--cites`, a pull request's own address, an act's links, a draft's citations, a parked post's message, and every address any of its
sentences spells out, Slack's own `<URL|label>` and a Markdown `[label](URL)` each read as one chip (when the label names another pull request or ticket, the label as words then the address as its own chip; another site's link is one chip under its label, so a card links the Slack thread it replies in and the Vanta control it names, or under the place it points at when it has none: `monitor 4412`, `control change-management`), and a GitHub issue's address claiming its `#N`, `owner/repo#N` and `repo N` for the issue). A number or key no address names resolves through what the ROW knows instead
(`cardReferences`, `site/lib/cardReferences.ts`, in scope for every sentence of the open drawer): its repository —
an ask's `repoSlug`, which `handover list --json` and `handover row --json` read off the `repo:` path's `origin` (3s a path, 20s for every path together and never past the command's own `--deadline`, read FIRST, before the journals and the probe sweep, so work that spends the deadline never costs a card its repository, and stalled checkouts cost those paths and never the board), a decision step's linked
ask's, else the one repository its addresses share, else for a row placed in the `self` workspace
(`site/lib/workspacePlacement.ts`) the one repository named `slopweaver` (the work context covers several, so it names none) — links
`#N`, `PR N`, `acme-admin 16406` (no more digits than that repository's largest) and a number standing alone, `Decide 16406`, when it runs to exactly as many digits as the
largest number any queue or board row carries an address for in that repository, no more than 10% past it (so
`port 3000` on a slopweaver card stays words), is not a year and does not follow a value noun (`port`, `pid`, `line` …, or another register's `issue`, `ticket`, `finding`, `rfc`, `turn`, `monitor`; such a noun's `#N`, `timeout #N` or `issue #N`, links only through an address the row carries). A number that repository cannot hold goes to the ONE other attested repository the row's own words name — a five-digit `#N` on a slopweaver-backed ask whose evidence says `acme/acme-admin` is acme-admin's — and two such is words; a row with a repository that names no other one — attested by name, or any in a GitHub address, before `#N` or `PR`, or under an owner the queue knows (a bare unknown `owner/repo` reads as a path, `packages/seed-fixtures`, and is not counted) — goes to the ONE other attested repository it fits, so `16406 open` on a slopweaver ask that never spells acme-admin is acme-admin's, the only repository on the board whose numbers run to five digits, and two such is words; a number home CAN hold stays home's, the row's own repository, and a number spelled after another attested repository's name (`acme-admin 17594`, any case of `PR` or `pull request`) links there when it fits; and the install's Linear workspace and team keys (the board's `referenceContext`, Linear's own org and teams out of a directory that lists every provider's, and no workspace at all when it holds two Linear orgs, since a team key carries no org)
link `QQQQ-134` — so an ask carrying no address at all still draws no plain-text pull request number or Linear
ticket id, in every case. A record
another register holds links the same way, through `referenceContext.records` (`src/cli/recordReferenceFacts.ts`, read leniently by `site/components/live/readRecords.ts`): every monitor the Datadog census mapped, on its site's
console host, and every Vanta control and risk with a printed id, a control to its own page and a risk to the risk
register. So `monitor 50001`, `monitor #<id>`, `Monitor IDs: 50001`, `monitorId=50001` or `` monitor `50001` `` is
the Datadog chip, its hover card naming the monitor, as is every id of a list (`monitors (50001; 50002 and #<id>)`),
and one the census never mapped stays words, never a pull request, unless a later id of a list is a pull request the
row carries; `HRS-29` and `TTX-2`, in capitals and not a Linear team's the install or the row knows, are Vanta's, because a monitor or control id the owner cannot follow tells them nothing until it is a citation chip
to the record itself. A stale census still chips a deleted monitor. The trade,
stated: a same-length count (`10000 rows` on acme-admin) links too, and with no address for a repository anywhere on the queue or board its numbers standing alone stay words, since nothing says what scale they run to, while a `#N` on the row's own repository still links, the `#` naming a pull request by its spelling. Its hover card names the pull request and carries
"open its diff here" (the console's `/files` tab, `citationFooterOf`), the diff the owner asked every named PR to link. A number or key the carried addresses claim but disagree on, a number another repository names (`slopweaver 16406` or `slopweaver #N` on an acme-admin card), a date (a month name and a day), a time (`11:15`, `11 AM`), a decimal, a fraction (`16400 / 16406`), an amount (`$ 16400`, `USD 16400`), a range (`16400 - 16406`, `#N–M`, though `PRs N–M` links both ends), a number or key inside a hyphenated name (`post-16676-draft`, `QQQQ-134-notes`, even with that key's address carried),
`CI 93` and `UTC-5` are left as words, never guessed, and so is a key whose team the install does not know. A queue row is a link already,
so it prints the label alone (`inlinePlain`). Everything else the row points at is a line in the folded record — a pull request the
row's FULL text names (`prUrls`) that the card never does, the Slack thread, and the row's own `anchor:` when
it is an address and not the thread, so the owner never has to navigate to a pull request or a Slack thread
themselves. An ask card is headed by its ask: `handover ask`, `correct` and `register` (on a row waiting on the owner's word) refuse text whose first two sentences ask nothing unless the `unaligned-card` hatch is open (`src/handover/cardAlignment.ts`),
and an older row that asks nothing is headed by its lead as written, never labelled — a "No question stated" label over a card left the owner unable to
tell what they were reading. A question the owner already ruled on, asked again in the same words by `talk restore` or by hand, is drawn as a check-in carrying that ruling, and `handover ask` refuses one unless the `ruled-reask` hatch, `SLOPWEAVER_ALLOW_RULED_REASK=1`, is open (`src/handover/ruledReaskGate.ts`): a re-ask that needs the owner again says what changed since their ruling. A card with no anchor names the session
that registered it and the run it held (`registeredBy`/`registeredRun`, [card alignment](../../skills/handover/reference/card-alignment.md)). An act card is drawn on the [Alignment page](./alignment.md), never on the queue, and leads with its WHAT — the what is the entire point — the rest of the record sitting behind one disclosure. A field a register cannot fill (a problem, stakes or lean on anything but a shaped ask or a finding's pull request, a what on an act recorded before `said`) is no row at all, never a sentence explaining the gap, and `site/lib/briefingCardForm.ts` REFUSES a card that draws text for a field its record does not hold, judged against the record rather than the wording. An act's links come from `actLinks` (`site/lib/queueCardActLinks.ts`): the open pull request `actPullRequests` (`site/lib/queueCardAct.ts`) joins out of the landing reading (URL, then
declared board row, then a head branch exactly one pull request carries), the pull requests its board row
publishes and that row's own queue card (`/queue?open=ask:<slug>`, only when the queue holds one — never
the row itself, which has no page), then the `https://` addresses and local pages `actLinks` finds in its prose, and while the board
or the landing reading is unread, that a link may still be missing. An act that links nothing draws no links row at
all. A landing match only LINKS, because that reading is open, undrafted and
bounded. Every finding act looks its pull request up by branch, one lookup at a time for each act the Alignment page draws before the owner
opens it (`useActPullPrefetch`, skipped during a call) and again when its panel opens, drawing the kept answer
meanwhile (`site/lib/actPullCache.ts`, 12.5 s per lookup measured) (`useActPull` →
`/api/act-pull`, `site/lib/actPullVerb.ts`: `github search "is:pr head:<slug>"` in every state, then `github
pr summary` keeps an exact head match on this repository, never a fork's, and parses its own Problem, Risk and Blast radius); `withLookedUpPull`
(`site/lib/queueActRow.ts`) DRAWS the card from the pull request (`site/lib/findingActCard.ts`: a what naming `#N`, its state, its title and why the fleet opened it — the
Problem cell's first sentence, so the card answers what it is about, held back whole rather than cut when it would run the what past its word cap — then Problem, Risk, Blast radius, PR status) only for exactly one with nothing unread, no other GitHub address linked and a description that gave
those cells, and otherwise REFUSES it (`ActCardForm`): the card draws the reason and its links and no problem, stakes or option row. Every one of
these links, and every inline reference, is ONE colour-coded `CitationChip` with its integration's app icon, its kind
read off the reference and never the prose — [citations](./citations.md).
`site/lib/inlineCitations.ts`, `site/lib/cardAddresses.ts` and `site/lib/askLinks.ts` hold the derivation rather than the component for the same mechanical reason `queueCard.ts` does: the unit lane collects
`site/__tests__/unit/**` and does not transform `.tsx`, so a rule living in a component is a rule no test can reach.

**An ask row says what it is REALLY waiting on, and only a row that is the owner's shows an age.** Every surface
that renders "waiting on your word" reads the board row’s `ownerWait`, never `question !== undefined` —
which four of them independently did, two of them in the queue.
MEASURED, `slopweaver handover list --json` over 2,690 rows: 42 carried an open recorded
question and the console called all 42 the owner's, while **7** carried a register ruling decided at or after the
question (the owner's own example opens by saying the chosen option had already landed on main), **4** were settled and
**10** were paused. **21 of 42.** The verdict is derived once by `src/handover/ownerWait.ts` and published
per row alongside `questionAskedIso`, the instant the question was asked, so a 22-day-old ask stops looking
like a three-minute-old one.

Three consequences are the rule rather than notes. `handover list --json`’s `status` is the DERIVED
status (`authoredStatus` carries the `status:` line, `statusFrom` says which register decided) — 1,062 of
those 2,690 rows disagreed. A row that is not the owner's carries **no age at all**: `src/handover/paused.ts` holds
the owner's ruling that work paused on a person has no time limit and no deadline, and a day-count beside a row
paused on a person reads as the countdown the owner ruled out. And the queue LISTS only the rows that are the
owner's, because it is the one pane answering what needs the owner's steer right now — the rest stay on the board and on Workstreams, and
the page prints how many were left out and what each is waiting on, counted through the same work-context
filter the list ran. The page’s own half of that — which rows it lists, in what order, what age it may
print — is `site/lib/ownerAsks.ts`, which imports nothing and is pinned by `site/__tests__/unit/`.

**A row anchored in Slack draws the thread, and a card about one opens on it**, read from the corpus, its
messages drawn as Slack draws them, ahead of the WHAT, because the thread itself is what the owner wants shown. Which
rows, the read, and the read-only held reply under it: [slack-thread](slack-thread.md). An email-born row:
[mail-thread](mail-thread.md). `SlideOver.tsx` is the one shell: non-modal, focus in on open and back on close,
and none of its three ways out closes it while an act is in flight. Not here, and said on the page: email drafts
to approve (`gmail send` takes a draft id, and no verb lists those — `gmail list` prints message ids) and enqueue
from the pull-request panel (it needs the repository named and the verb's dry-run report shown before a press).
The chair's open-pages index is absent too, and `content/console/queue.mdx` says why: it is a scratch file no verb
prints. A press on a panel's button settles its row (`components/console/settling.tsx`): the panel closes, the
row leaves the queue and the badge at once, and one line says what was recorded, with what the verb wrote
behind a disclosure. A refused or unknown outcome puts the row back and says so. The counting strip and its explanations sit behind one line above the list. **Come back to it**, in the header of every panel but an act's, settles nothing: the card moves below every card the owner has not put off, its tier, the badge and `queueCounts` unchanged ([coming back to a card](coming-back-to-a-card.md)).

## Triage walks the Queue's own cards

Triage is one clock a card over the Queue's own cards, never a page of its own: the length the owner names ("ten on this one"), else two minutes a card and ten a briefing. "It's triage time", said on a call, typed into the console or picked from the menu bar, walks the owner's cards
one at a time in the Queue's own order with a card the owner put off after every card the owner has not, bar one
stopping the owner's work, which keeps its place (`site/lib/triage.ts`). The clock counts down beside the menu bar item and chimes at zero, where the owner hears three ways out with one suggested;
Pause timer and Turn triage off sit in that menu, on the voice's overlay and on every floating note while triage is
on — [the voice triage pass](voice-triage-pass.md).
