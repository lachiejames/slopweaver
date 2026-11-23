# The Alignment page

The console's `/alignment` page holds every question about whether something was, or would be, the right call.
The Queue holds what needs the owner's hands, the owner's priorities and what unblocks the fleet, and nothing else.
That split is the owner's ruling: a question about the right call, past or hypothetical, belongs out of the Queue.

## The split is by kind, and it is a partition

`site/lib/alignment.ts` decides which page draws a row: an `act` row — the autonomy ledger's account of something the
fleet already did — is an Alignment row, and every other kind stays on the Queue. A hand step posted `--check-in`
and an ask that looks answered already still ask the owner for something, so they stay in the Queue's check-in tier.

It is a **partition of the one board, never a second register**: every row is still built once by `rowsOf`
(`site/lib/queueRows.ts`) and filtered by work context, tags and settling as before. `useQueueRows` returns the
Queue's side as `rows` and the other as `alignment`; the Queue's view counts, the sidebar badge, the voice's
triage pass and its `action_items` all read the Queue's side, so none of them counts an act. An act was moved here, not deleted
and not re-asked: its ledger line and any word the owner already gave on it are untouched.

**It is a sidebar entry, between the Queue and Pull requests.** The owner placed it there because how Slopweaver
aligns with the owner while the owner lives in it is one of the most distinctive things about it, and that has to be
prominent. The sidebar
entry is how the owner reaches it, and the Queue's bar carries no link to it. The Steers page folded in as its last
section, `#steers`, so steers and alignment are tracked over time in one place. That section is
`site/components/live/Steers.tsx` unchanged — each steer the owner gave on a call, whether it has been applied, and the
weekly chart.

**Nothing on the page chases the owner.** No count on the page or on its sidebar entry is drawn in the hot tone, no
floating note or DM points at it, and no work waits on an answer here. The sidebar entry does carry a plain NEUTRAL
number: the general-ruling questions the owner has not answered, and nothing else. The page's head prints the same
number off the same hook (`site/components/console/useAlignmentWaiting.ts`), and it reads 0 when nothing waits.

**Acts are never counted.** An act the fleet already did stays listed on the page to look back on, but a count of
acts grew with every merge the fleet pressed under a standing rule, past a thousand, into a number nobody would
answer. Only a card that needs the owner's call is counted, so the board, which places acts, is no input to it.

**What the count reads.** The count is `alignmentWaitingReadingOf` (`site/lib/sidebarCountsAlignment.ts`) over the
four readings its questions are made from: the autonomy ledger (the act-kind rulings), the parked-draft register and
the owner's feedback on drafts (the card-class rulings), and the owner's answers. A reading on its way or failed
is the progress indicator or the failure, never a zero. **A reading handed over from the page before counts,
marked**: the Queue holds every reading this count is made from, so on a click across each arrives already read and
is read again behind the page's own first reads; the count prints at once, stale as of the oldest such reading and
naming each (`countBasisOf`), rather than the progress indicator until every re-read lands. A stale count names no
first question.

**The mark says which of two things it is** (`StaleCount`, `site/lib/sidebarCountsBasis.ts`), because a count merely
being updated that reads "It failed with a technical error" reads as broken and is false. **Being updated** — off a
handed-over reading while the current one is on its way — is the console's progress indicator beside the number, its
hover saying how old the number is and what is being read now; never the warning glyph. **A read failed** is the
warning glyph, one line per failed read in plain words with its raw message folded beneath, then what the console is
doing about it. **The owner of that recovery is `site/components/console/useAlignmentAutoRefresh.ts`**, run once in
the shell's one Alignment hook, deciding through the pure `site/lib/alignmentAutoRefresh.ts`. The two readings read
once per console session (the autonomy ledger and the owner's answers) are read again after a failed read on a 1, 2,
4, 8, then 10-minute backoff, only while the window is in view, the first a minute out rather than at once; the count
says so off the runner's real state ("The console tries again today at &lt;time&gt;", "… is reading it again now"). The polled
readings recover on their own poll. A read that reads current leaves the runner; it is failure recovery, never a
cadence.

Until the board answers, the act list never draws its empty state. Once read, an empty section draws the console's designed empty
state (`PageEmpty.tsx`): the rulings say a question appears after the same kind of correction twice with no standing
rule covering it; the acts say one appears when the fleet acted unasked and nothing already answers it, with **Connect
a plan**, which opens Settings on Models, while no plan is connected. Each stands only on readings whose latest read answered (`emptyProvenOf`,
`site/lib/pageEmpty.ts`): an act list the spoken cards, a held steer, the board or the landing reading emptied waits for
each of those readings to be current. Until then a section emptied only by a kept reading draws a plain line saying so
(`emptyDrawOf`), never a blank. A `/queue?open=act:…` link
redirects to `/alignment` (`site/next.config.mjs`), and `src/hand/consoleLink.ts` mints
`/alignment` for an act directly. Such a link, resolved by `rowForOpen` (an earlier act folded into a newer pattern
included), opens the slide-over of the act's kind on that act's card, scrolled to; pressing another kind or closing
the panel takes `?open=` off the address, so the link never reopens it.

## What leads the page

Asked whether the page should lead with the questions most likely to improve the fleet's behaviour or the most
recent, the owner chose the ones most likely to improve the fleet's behaviour: high-value targets at the top, never a
month-old merged pull request that was the right call.

So the page opens on **Start here** (`site/components/console/AlignmentStart.tsx`): the first question the owner has not answered,
what one answer could improve from then on, and the count behind it. It is a pointer to that question's own card,
never a second copy; touching it makes that question the one the owner is answering. The order is `alignmentOrder`
(`site/lib/alignmentRank.ts`), and the sections below are drawn in it:

1. **General rulings**, act kinds and card classes in one list, by how many times the owner has had to say the same thing
   (distinct acts steered, distinct draft chains sent back), most first; a tie goes to a card class, which would
   govern every card reaching the owner, then to the key.
2. **Acts**, one Queue-shaped row per kind of act (`site/lib/alignmentKindCards.ts`), the kind carrying the most
   acts first, then the one acted on most recently, then by kind. A row opens the Queue's slide-over holding that
   kind's act cards, newest first. A word on one changes that act only, so an act never leads while anything broader
   waits.

The owner's voice is no question here, so it never leads ([Your voice](#your-voice-learnt-never-asked)).

An answered question never leads, and within its section sits after the unanswered ones. **The order is derived, and
this page of docs says so, never Start here** (the owner's ruling: no page carries a note on how it is derived): which
question the owner would care about most is a session's judgement, and no visible session has journalled a ranking verdict
yet, so the order is how often the owner has had to say the same thing and how widely one answer could apply. A ruling the owner
gave often long ago can still lead, since nothing here can tell that the behaviour behind it stopped. Start here
waits for every reading the page's count is made from, shows the progress indicator or a staleness mark naming the
failed read until then, and says `No general-ruling question waits on your answer. A measured zero.` when nothing
does. Start here names a general-ruling question only, never an act, so it agrees with the count printed above it. The
voice reads the same first question off the page reading's `first`.

## Slack steers: what the owner has had to correct, one line per kind

Under Start here sits one chart (`site/components/console/SlackSteers.tsx`): a coloured line per kind of correction the owner
gave on a Slack message written as the owner, one point per week ending today, over the drafts the owner reviewed each week as
faint bars. Pressing it opens one
small chart per kind; pressing a kind opens the owner's dated words about it, each folded onto the whole turn. The owner's ruling: the charts and their titles are the most prominent thing,
drafts and quotes stay folded.

- **A point is one turn of the owner's, per kind it names**, however often it repeats it. Whether a turn names a kind is a
  read a session journals with `profile steers judge`, never a keyword match; a turn that only implies the pain is
  left out ([the profile skill](../../skills/profile/SKILL.md)).
- **No threshold, no pass/fail colour.** A kind says when it was last named and "nothing observed for N days". A
  problem is never drawn solved by silence: only the owner's own words that it stopped, journalled `--says stopped`, are
  shown, marked apart.
- **The reviewed count is under every chart** (`slack draft corrections --json`'s `reviewed`), so a quiet week reads
  as fewer drafts rather than as better ones.
- **It charts the owner's words, never the bot's self-checks**, and asks nothing: a high rate is not an action owed.

**Who owns the data.** The per-kind verdicts are this page's own register, the store's `steer_measurement` table,
appended only by `profile steers judge` and never changed or removed; an old `judgement/steer-kinds.jsonl` is
imported into it once. The turns it reads are `profile words`' (`src/cli/commands/profile/wordsRun.ts`), the
same owner words the first-try-approval seat derives laps per Queue card from; that seat owns laps and first-try
approval, this page owns which kind each turn names. Neither keeps a second copy of the owner's words.

**Not seen yet**, and printed under the chart rather than hidden: a turn naming a kind in words no cue matches is
never offered for reading, and nothing the owner said before the supervisor chain's first chair or outside a console call,
the console or a chair is read (`STEER_RESIDUE`, `src/profile/steerKinds.ts`), so a steer the owner typed to the bot in
Slack is not on the chart.

## Voice cut-ins: what reads as the console's own line inside an answer

Under Slack steers sits one more line (`site/components/console/ScriptedCutIns.tsx`), drawn by the same
`WeeklyChart`: each answer what reads as the console's own progress line was spoken inside, one point per week over 60 days, with
no bars under it. The owner reported the voice starting one answer, cutting off halfway and giving a different
one. The mechanism was most likely ours, not the OpenAI voice's: the progress line
was appended 15s into a delegated turn, then every 30s, and could not be withdrawn, so a turn finishing inside that
second could have its answer spoken around the line. The owner left it unfixed at the time. The console now plays a
sound instead of speaking the line ([why](walk-silences.md)), so the chart reads history and
counts nothing from `PROGRESS_SPEECH_RETIRED_ISO` (`src/talk/progressLine.ts`) on. The count is `talk cut-ins --json` (`src/talk/scriptedCutIns.ts`), which counts a line only
inside the call's own Codex turn and after words of the voice's own; each occurrence sits behind
one press, and a call file that did not read whole puts a staleness mark beside the total, naming it and why on hover,
rather than being counted as none. The call file never records the console speaking the line, so the voice saying those exact words itself inside
that window counts too: the count is evidence, not proof of who spoke. The voice runs the same verb (`--since 1h`, on
its read list in `src/talk/modelReads.ts`) when the owner says it cut off and started a different answer, and only when one
is listed does it tell the owner plainly that it was most likely this setup and that it is counted
(`src/talk/candourLines.ts`).

## What it asks, in order

Every question leads with a concrete "hypothetically" scene and what the fleet did or would do in it, then takes
**one freeform answer**, said aloud or in the call's chat with the card touched — the console's one text input
(the owner's ruling). The card draws no box and no option list; touching it, or focusing anything inside it, makes it
the page's open item, so the call's relay names its key.

| Section                   | Key                       | Built by                     | The owner's words go to                                          |
| ------------------------- | ------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| Make it a general ruling? | `align:rule-<kind>`       | `site/lib/alignmentRules.ts` | the supervisor, as a relay naming the key (`talk relay`)         |
|                           | `align:rule-card-<class>` |                              |                                                                  |
| Was this the right call?  | `act:<actionId>`          | the autonomy ledger          | that one act's ledger line (`autonomy steer`), and that act only |

**"Was this the right call?" is one row per kind, and its act cards sit in the kind's slide-over.** A kind row
(`site/components/console/AlignmentKindRows.tsx`) names the kind, how many acts its cards carry (a pattern's earlier
acts included, each act once) and when the newest was done. It is a way in, never a question: it carries no key of its
own, and opening it makes no act the open item until the owner touches one. The slide-over
(`AlignmentKindPanel.tsx`, the Queue's `SlideOver`) draws each act card exactly as before
(`AlignmentAct.tsx`, related guidance included); an act folded into a newer pattern stays on that pattern's card, never
a card made up from a raw ledger line. Each row carries its cards' `data-card-key`s hidden, so `desktop e2e
--call-card all` still reads every act key off the page.

**A general ruling is asked, never assumed.** A word on one act edits that act only. When a kind of act carries the owner's
own word on at least `REPEAT_FLOOR` (2) acts that no class steer covers, the page asks whether those words should
stand for the kind, quoting each wording with how many acts it was given on and when.

**A card the owner keeps sending back for the same defect is asked about too** (the owner's ruling: five
cards sent back with the same feedback — the fleet did not bring the receipts — should become a ruling). A triage relay that sends a card back
names the class with `--feedback no-receipts|not-at-a-glance`; the page reads those off `talk log --about-prefix post:
--json` and counts each class once per draft CHAIN, folding every re-cut (`--supersedes`) into the row it began as,
so one card re-cut three times is one count. A class named on `REPEAT_FLOOR` (2) chains draws `align:rule-card-<class>`:
the owner's words on each draft, newest first, and whether every card should be held to it. Answering it is a ruling or a
preference by the owner's words; it is never dispatched as work by itself, and no gate is built until the owner says so. Both kinds
share one list in the page's order, and its measured zero is printed only once the ledger and the owner's feedback have both
read and neither holds a question.

**Both kinds of ruling card carry Risk and Blast radius rows** (`site/lib/alignmentRulingStakes.ts`), drawn by the
same `RiskAndBlastRadiusRows` the Queue's cards use. They are derived from what was recorded, never from a table of
kinds, since a ledger kind is free-form. An act-kind card's Risk says what making the words standing would authorise
unasked and how many acts the ledger records over which days, and states that the ledger does not measure
reversibility; its Blast radius counts the GitHub repositories and distinct subjects those acts touched, and says
when a Slack thread or another non-GitHub surface is among them. A card-class card's Risk says the fleet would hold
back every card it judges to be in that class without asking, and that the draft readings do not measure how often
that judgement is wrong; its Blast radius is every card in the class, from the draft chains the owner sent back.

## Your voice: learnt, never asked

The owner's ruling: asking questions is the crude way to learn a voice. How the fleet writes
as the owner is learnt from the Slack messages the owner sent, so the page asks no voice question, Setup counts no voice step and
onboarding ends on no voice set. The **Your voice** section (`#voice`, `site/components/console/AlignmentVoice.tsx`,
the pure view in `site/lib/alignmentVoice.ts`) shows what is measured instead:

- **Slack not connected** (`/api/slack-connection`, the preflight `useSlackConnection` reads): the console's designed empty
  state (`PageEmpty`), saying the voice is learnt from the owner's Slack messages, with the Slack connect button.
- **Connected, measured**: each surface `profile voice --json` holds — everything the owner sends in Slack, the owner's DMs — with
  its median, three-in-four and nine-in-ten message lengths and when and over how many messages it was measured.
- **Connected, nothing measured**: an empty state saying what fills it, rather than inventing a default. **A Slack
  refresh fills it**: every refresh whose Slack ingest succeeds runs the voice leg (`src/cli/commands/refresh/voiceLeg.ts`),
  which counts the words of the messages the owner typed (`profile voice measure`, `src/profile/voiceMeasure.ts`) and writes
  `slack/all-sent` and `slack-dm/aggregate`. What a post through an app under the owner's name, an edit or a broadcast copy
  does to the count is in that file's header, and each cohort's `qualification` says it.
- **The bans the owner set** (`slack voice-rules --json`) fold below it: stated by the owner, never learnt, and refused by the send
  door.

**The indicator.** The strip at the top reads `Rough knowledge · your voice is not yet measured from your sent Slack
messages` until a surface is measured, then `Voice measured from your sent Slack messages · everything else is still
rough knowledge` (`alignmentStage`). It claims nothing beyond the measurement.

## Landing an `align:` answer (the supervisor)

An `align:` steer arrives as a relay whose ask names the key and says it is an alignment answer, never a work
item (`src/talk/relayAskText.ts`). The supervisor lands it as one of two things and never as a task:

- **A ruling** when the owner's words are one: an `align:rule-<kind>` yes is one `autonomy steer-class` over exactly
  that kind, anchored on the relay. An `align:rule-card-<class>` answer lands the same way, as a ruling or a
  preference by the owner's words, and never as a work row: building a gate for the class is a separate ask of the owner.
- **A knowledge row** when they are not yet one: a lean, a preference the owner flagged as a guess, a "keep judging each".

The page reads the owner's answers back with `talk log --about-prefix align: --json` and shows the latest under each
question. An answer still `intended`, with no registration, is not shown.

## Live reads

`voice-profile` (`profile voice --json`) and `voice-rules` (`slack voice-rules --json`) are slow-lane rows in
`site/lib/liveVerbs.ts`, read once per mount. `alignment-answers` (`talk log --about-prefix align: --json`) is a
fast-lane row, because an answer can land from a call or the supervisor rather than a press on the page; the
acts come from the `autonomy` row the Queue already reads. `slack-steers` (`profile steers --json`) is a slow-lane row
that stamps its own time, and `slack-draft-corrections` (`slack draft corrections --json`) a fast-lane one.
`scripted-cut-ins` (`talk cut-ins --json`) is a slow-lane row that stamps its own time. `triage-feedback` (`talk log
--about-prefix post: --json`) is a slow-lane row, and the card-ruling count also reads the Queue's parked-draft
register (`slack-drafts`) for the chains. Those four — `autonomy`, `slack-drafts`, `triage-feedback` and
`alignment-answers` — are every read the count makes.

**A number that changes between loads is live, or says its age** (the owner's ruling). An open page
re-reads `triage-feedback` each minute and `scripted-cut-ins` every five, both cheap at that cadence (their measured
walls sit beside the constants in `useAlignmentWaiting.ts`, the one hook this page and its sidebar badge share, and
`ScriptedCutIns.tsx`). `slack-steers` is too slow to poll (37.2s, its `liveVerbs.ts` row), so the Slack steers heading
carries its own age, re-told every ten seconds (`site/components/live/ReadingAge.tsx`), and once the reviewed-draft
reading is in, the age is the older of the two; the cut-ins heading carries its age too.

**Neither chart says how it is counted; this section does** (the owner's ruling: no page carries a method fold,
[work-console.md](work-console.md)). Each section draws its heading, then the chart and its figures, nothing more.

- **Slack steers, how a point is counted.** Each line is one kind of correction the owner gave on a Slack message written
  as the owner; one turn of the owner's is one point, however often it says it. This moves slowly: day one will not look
  different, and one long conversation can move several lines at once. What it cannot see is the verb's `residue`
  (`STEER_RESIDUE`, `src/profile/steerKinds.ts`), printed by `slopweaver profile steers --json` and no longer on
  the page: a turn is offered for reading only when it holds a kind's cue and a word placing it on Slack, so one
  naming a kind in other words is never read; the owner's words before the supervisor chain's first chair, and anything the owner
  said outside a console call, the console or a chair, are not read; and a kind with no turn naming it is not a
  solved kind, it stays open until a turn of the owner's says it stopped.
- **Voice cut-ins, what counts as one.** Each point is a week's answers that what reads as the console's own
  progress line cut into, so the voice stopped halfway and carried on from the line. That is most likely this
  setup, not the OpenAI voice: a call records the words, not which of the two said them.
- **A general-ruling question's drafts** list the owner's words newest first.
