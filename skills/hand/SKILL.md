---
name: hand
description: Record a step only the owner's hands can take, draw it as a floating macOS note above whatever the owner is looking at, and push the owner one notification when a new one arrives. Use when a run has met the narrow thing a session genuinely cannot do — a sign-in, an approval, a code-owner pick, an access ask to its holder — and the run is stopped until the owner does it. Phrases like "the owner needs to sign in", "this needs the owner's approval", "put it on the owner's screen", "the owner has to pick code owners", "tell the owner a live thing is blocked". Only the pinned supervisor posts one; a seat sends it a line instead.
argument-hint: "post --id <slug> --what <one sentence> --unblocks <what waits> [--if-ignored <what doing nothing costs>] --witness <settling command> (--row <slug> | --standalone) (--blocks | --check-in) [--supersedes <open id>] (--url <address> | --open <kind>:<id> | --literal <paste> | --checklist <json> | --no-address <why>) [--opened <page>] [--where <place>] [--cites <url,url>] [--context slopweaver|work] [--recheck browser-session:<origin> | slack-member:<channel>] | list | show <id> | push [--dry-run] | done <id> --did <what happened> | snooze <id> --for 1h|3h|tomorrow | wake | mute list|add <kind>|remove <kind|subject> | recheck [--dry-run] | retract <id>… --why <text> | line-retire [--apply --source-sha256 <hex> --reason <why>]"
---

A run that needs the owner's hand and cannot get it is stopped, and **the expensive half is that the owner does not know**.
This noun is the answer to that: the step goes into a register, a floating note carries it above whatever
window the owner is actually in, and one notification says a new thing arrived. **The note is the ONE surface that
interrupts the owner**: cmux raises no banner and no sound for anything, the chair included (`monitor filter`:
cmux notifications are dropped entirely and these floating macOS notes are used instead).
The owner asked for a floating macOS note (outside the browser tab, Raycast-style) that carries the one step the
owner must do right now (copy this, paste it there, click that), and a push notification lane that reaches the
owner off the fleet briefing: a live thing is blocked, come sign in; these PRs are ready, pick code owners.

## Only the supervisor posts, and never to ask for money

**`hand post` refuses all but the pinned supervisor** (`src/hand/seatPost.ts`, hatch
`SLOPWEAVER_ALLOW_SEAT_HAND_POST`): a seat SendMessages the chair or records a `handover ask`. **Every writer is
refused a step naming a purchase of a plan, subscription, usage, credits or a tier** (`src/hand/purchase.ts`).

## Post one only when the fleet genuinely cannot

Rule 10 is the gate before the verb is: **a session that can do a thing does it**. A row saying "the session
rotates the key" is work being filed rather than done, and a register that fills with those is the fourth
board the owner abandons. `hand post` refuses a sentence naming the fleet as its actor and says which phrase did it —
a **tell, not a fence**: it catches "the session", "a bot", "slopweaver will", and a sentence phrased around
those gets recorded, so the judgement is still yours ([the note](reference/the-note.md) § where it ends).

**A recorded question is never a hand step, and never a Slack DM**: a run
blocked on the owner's word belongs on the owner's Queue card, and the owner's bot DM carries a finding, a dogfood case
or a message the owner asked for; a `slack post --as bot` form send there names which with `--dm-purpose`
([the card form](../slack/reference/the-card-form.md)), while a live turn's reply to the owner's own ask is not a form send.

**A proof witness is never a hand step**. It also refuses an `--unblocks` naming gold, silver, bronze
or a proof: take the witness yourself, posting any human half as the owner to the bot, never to a colleague
([pull-requests](../github/reference/pull-requests.md)). A try-this note still posts; it says what it gives the owner.

**The one line says what to do in words the owner already has, and a reaction opens its queue item.** A note
that asks the owner to steer "a call that opened with a context pack" is not a task the owner can do
without knowing what a context pack is, which page it appears on, or which buttons to click. So `hand post` refuses a `--what`
carrying a fleet word that is not the owner's (the glossary's
`notOwners`, `slopweaver talk glossary`), and a step asking the owner to react to, decide, steer or pick something on
the queue that links nowhere, or to the queue list without its item: `/queue?open=<kind>%3A<id>`, the ask or pull
request, else `hand%3A<this id>`. **An `incident-` row's step opens its PROOF** (a published page's viewer address,
or Datadog), never the Queue, a CI run or a PR; **"approve the fix / PR / post" opens a page or the PR**, never a
console list (`src/hand/proofLink.ts`). Edges: [plain words](reference/plain-words.md).

**A decision opens the ask that holds its choice.** A step asking the owner to decide — "decide", or an explicit
alternative ("now, or hold it", "whether … or") — is refused unless it opens an ask, a pull request, a draft or
the page the choice is made on; never itself. Record the choice first with `handover ask --problem --options
--lean --risk --blast-radius --still-real`, name any parked draft by its `sd-` id in an option, then post with
`--open ask:<slug>`: the queue draws that ask's problem, options, trade-offs and stakes on the step's card,
its pull requests and thread as context, and the draft exactly as it would post. A step or ask naming an `sd-` draft
the register does not hold is REFUSED, and so is a step saying "drafted as you" that carries no draft
([named-drafts](../handover/reference/named-drafts.md)). A step whose note buttons read as options the owner
cannot make sense of is a defect of this class. A writer with no ask to open — a monitor card — CARRIES the choice
whole instead, as the step's typed `decision` (`src/hand/decisionContext.ts`), and the queue draws it the same way.

**Every posting answers the form, whoever writes it.** `postingRefusal` (`src/hand/posting.ts`) runs inside the
store's own append, so no lane skips a rule `hand post` applies (the monitor lane once posted 25
context-free cards). **`--what` says the act AND what it is about** — after the act, a `so`/`because`/`until`/`: `/`—`
clause (`src/hand/headlinePurpose.ts`).
**It says what a thing is before its code**: "the network-separation evidence (NET-93)", never a bare `NET-93`
(`src/hand/headlineCode.ts`, [card-alignment](../handover/reference/card-alignment.md)). **It leads with the discussion, never a PR**: no PR link, `#NN` or "approve the fix" first (`src/hand/prLedHeadline.ts`).
**No prose the card draws names a session, call, talk, turn or run by its machine id** — `--witness` included, and the decision of an ask it opens too, or the Queue withholds the card while the note stands (`src/hand/machineIdInProse.ts`).
**A card names its row and leaves when that row does**: `--row <slug>` or `--standalone`,
and `--supersedes <id>` re-cuts in one append, one open card per row ([row and re-cut](reference/row-and-recut.md)).

**Every step says where it happens, and none asks a bare go-ahead**: `--url` or `--open`, a
`--literal`, or `--no-address "<why>"`, drawn as a row, so a sign-in with no link still tells the owner exactly the
right place to go. **A host the step names (`dashboard.clerk.com`) is what the card draws FIRST**, as its **go to** chip, the card's one call to action — `--opened`, else a `--url` that is not the card itself, else a sole `--cites`, or a checklist line's page — on that host or under it, never its parent; a notice is exempt (`src/hand/placeLink.ts`); `hand list --gaps` checks every open card. A sign-in carries its page as `--url`, `--opened <page>` plus `--where` for a window the fleet ALREADY opened, or a `--literal` plus `--where`; **a literal never carries a command the fleet can run** — refused, so the seat runs it in the background and the owner only signs in (`src/hand/runnableLiteral.ts`) — **and a command of the owner's lives ONLY in `--literal` (ONE command) or a `--checklist` line (one per line)**, each its own copy block: one in `--what`/`--where`/`--unblocks` is refused (`src/hand/commandInProse.ts`), and so is a `secrets set` of a name the shipped registry lacks, `hand post` naming the branch to land first (`src/hand/secretName.ts`); a literal of ONLY `slopweaver secrets set <name>` lines, one name each, draws a secure paste field per name on the queue card IN PLACE of the copy block, so say `--where "the fields on this card"` and the owner never opens a terminal ([pasting a secret](reference/pasting-a-secret.md)), while a `secrets set` on a checklist line names where its value sits on the page ([the checklist](reference/checklist.md)), and `--shot <png>` with a `--box x,y,w,h=label` per thing to grab draws the provider page above them with a numbered red box on each ([showing the page](reference/showing-the-page.md)) — and a listener sign-in like the application-default login stays the owner's ([waiting on a sign-in](reference/waiting-on-a-sign-in.md)); `--no-address` never excuses one; a PLAN sign-in names the plan's email, never `plan-three` alone. "Say the word", "OK to", "want me to",
"should / can / may I" post only with something to weigh — a `decision`, `--cites`, a record link, a named `sd-` draft; an
obvious act is done and `autonomy record`ed. [Plain words](reference/plain-words.md). The set is narrow and the owner's:
**a sign-in, an approval, a code-owner pick, asking an access holder for named access** — out of ability, not patience. A seat mid-investigation, neither done nor blocked, runs `slopweaver hand surface`: its honest report, a Queue line every time, and this line for the chair unless silence risks nothing bad and the owner has not asked to see it — the owner's test is risk either way, and when close, surface ([mid-investigation](reference/mid-investigation.md)).

```bash
slopweaver google adc --row datadog-monitor-deploy   # a seat: prints the ONE hand post line to send the chair
slopweaver hand post --id adc-signin-datadog-monitor-deploy --what "Sign in to Google Cloud from a plain terminal of yours" \
  --literal "gcloud auth application-default login" \
  --where "a plain terminal, not a Claude session; pick your work Google account when the browser opens" \
  --unblocks "board row datadog-monitor-deploy, stopped until Google Cloud application credentials work" \
  --if-ignored "the Datadog monitor deploy stays unshipped, so its alerts stay off" \
  --row datadog-monitor-deploy --blocks --witness 'slopweaver hand done adc-signin-datadog-monitor-deploy --did signed-in'
```

**An artifact is `--url`, never a command**: a published page by its viewer address, never `file://` or a bare `.html` name. **The post opens `--url` first**, refusing an error or empty page and an unmerged `--check-in --row` ([showing the page](reference/showing-the-page.md)); the note draws a blue **Open**. `hand post` refuses a `--literal`
that is only a link, or any `open`/`xdg-open` naming one (flags and all): the note's own button opens the page, so a pasted `open file:///…/index.html` is
redundant.

**A queue row is `--open <kind>:<id>`** (`ask:<slug>`, `hand:<id>`, `pr:<owner>.<repo>.<n>`, `draft:`, `post:`, `act:`): it
mints the console deep link, carrying `--context` as `&context=`, so Open lands on that row's panel in that
row's context. A hand-built `--url` queue link with no `context=` gets `--context` added the same way. The link carries the STEP's context, so
state the linked row's when they differ; a mismatch still opens, because the console switches to the row's. The
console switches to a linked row's context by itself too, so a link without one still opens the row, so a deep link never lands on a row the current context hides.

**A pull request the step names is `#N` plus `--cites <url,url>`.** The queue card draws `#N` and `<repo> PR N` as
a citation chip, which needs its address; `--url` is usually a console page, so `--cites` carries the pull requests,
Linear issues and any `https://`, console-route or local record the step names, each its integration's chip. `hand post`
refuses a `#N` neither carries, and a bare `PR N` or `N PR`. The card can infer a number's repository from the step's own
(`docs/console/queue-and-triage.md`), but the post still carries the address: an inference is the console's, never the
note's. Spell a bare number `#<n>`; every PR and ticket number is a real citation chip.

`--unblocks` and `--witness` are REQUIRED: "sign in to Google Cloud" alone sends the owner hunting for what it was for and
how to say it is done — the context switch this exists to remove. **Write `--if-ignored` on every `--blocks` step**: what
happens if the owner does nothing, drawn under the chip, the line the owner ranks the card by ([the card](reference/what-the-card-shows.md)).

**Add `--context slopweaver|work` whenever the step belongs to one of them.** The console's switcher reads a
row's prose for a repository slug, and the steps this register is FOR — a sign-in, an approval, an ISO word —
name no repository at all, so an unstated one is placed by a heuristic over the organisation's own subjects
and sometimes placed wrongly. It is `slopweaver` or `work` and nothing else; leave it off for a step that is
genuinely neither. It is also immutable: re-posting an id with a context added is a STEP_ID_CONFLICT, not an
amendment, so state it when you post: ISO work belongs under `work`, never under `slopweaver`.

**Every step says `--blocks` or `--check-in`, exactly one** — `--check-in` when the fleet already built it and only
asks for a review: a dogfood try (an autonomy act's was-it-right question is the Alignment page's). Every surface ranks by one rule (`src/waiting/rank.ts`):
a step blocking a colleague (`--context work`) first, the fleet's own blocked work next, check-ins last; the
note's eyebrow reads CHECK-IN. Immutable like `--context`. An unmarked dogfood step once led the voice's answer to
"where do I start"; the things that actually affect work lead.

## What the owner sees

The note floats top right, above cmux, Chrome and Slack, takes no keyboard focus, and puts `--literal` on the owner's
clipboard the moment it opens; a checklist step copies nothing until the owner clicks a line's command. **Done** settles the step; **there is no bare
dismiss**: **Not now…** offers **1 hour**, **3 hours**, **Tomorrow** (09:00 Melbourne), the step stays open and
the tick's `hand wake` brings the note back then; on a monitor's card **More…** adds **Never for this kind** (`hand mute list|remove` reverses it) and, where the monitor says what worse means, **When it gets worse** ([snoozing](reference/snoozing.md)).
Every answer writes a marker file, and every reading verb reconciles first, so the owner's click has landed before anything acts on it. **Clicking the command copies it**, and
the line above the buttons is re-checked every poll. A step's `details` (≤12 lines of ≤320 characters, REFUSED
past either, never cut) fold behind a **Details** row the owner opens (rule 7), drawn as entries in a capped region that scrolls; a step's `quotes` (2 or 3 verbatim lines with permalinks, `src/hand/quotes.ts`) sit ABOVE that row, and only `slopweaver incident note` sets them ([incident](../incident/SKILL.md)). Detail: [the
note](reference/the-note.md); how a long field is fitted to the screen instead of carrying the buttons off
it, [fitting the note](reference/the-note-layout.md).

**Notes stack, one per step**: a note never replaces another step's; each is its own draggable
window, cascaded so every title shows, leaving only on Done, Not now…, a retraction or its row settling. `hand
show` redraws its step; every other raise keeps its step's note or takes the slot past the highest live one.
Monitor notices stack like any step, newest in front; the meeting-prep note floats above all, in its own cascade
from the top left: [Open and notes that stack](reference/the-note-open-and-liveness.md).

**Everything else waits on the console's queue**, in the desktop app: every open step with Done… and Not now…,
each a `slopweaver hand` verb, nothing off the machine. Arrival is still `hand push`.

**A note may not outlive the program that drew it.** `osascript` reads the bundle once at launch — a note once showed dead buttons
because it ran a program cut before the fix for them. Every note beats its
program's build id, a raise never keeps one beating another build, and once the fresh note of that step is up the
old one **closes itself, writes no marker and leaves its step open**. A superseded note is not a dismissed one.

**And the note is not the only surface.** `briefing render --hand-steps` puts every open step on the Fleet Briefing, its
command in a copy-button paste block — a page cannot die with a logout or land off a display. `hand list` is authoritative.

```bash
slopweaver hand list                       # everything waiting on the owner, oldest first, by no other key
slopweaver hand list --ranked --json       # the shared ranking, each row carrying its tier
slopweaver hand show gcloud-signin         # re-raise one note
slopweaver hand snooze gcloud-signin --for 3h   # back in 3 hours, the step open; the tick's hand wake raises it
slopweaver hand done gcloud-signin --did "signed in, the deploy resumed"
slopweaver hand retract mon-park-x --why "a parked run, already on the owner's queue"   # a mis-post: settled as retracted, never as done
slopweaver hand recheck --dry-run   # each tick retires a step whose sign-in or channel join already holds (reference/rechecking.md)
```

## The push lane never nags

`slopweaver hand push` sends **one** notification and only when the outstanding set has GAINED a member since
the last recorded pass. Not on persistence, not on departure, and **never on age** — there is no clock read
anywhere in the decision. That is the owner's ruling that a wait on a person is a STATE and not a countdown, made
mechanical, and it is the property that keeps the lane switched on. Safe to run on a schedule for exactly
that reason. Detail: [the push lane](reference/the-push-lane.md).

Both of the owner's named cases are LOCAL reads: the blocked sign-in comes off the ask-lifecycle log `turn block`
writes, and "these PRs are ready, pick code owners" arrives as a hand step the session that got the pull
request ready posted. Neither goes near the network.

## macOS only, and it says so rather than failing

Every surfacing verb reports a platform that has no floating note and exits 0 — the step is still recorded
and `hand list` still reads it. A notification's own delivery is the one thing nothing here can confirm: if
banners are switched off for the script runner in System Settings, the lane is silent and there is no signal
that says so. [The push lane](reference/the-push-lane.md) § Stated residue.

## A bad LINE is reported; only a bad FILE refuses

The register is append-only. Every reading verb **prints a skipped line and reads the rest**; only a register
it cannot OPEN refuses. Measured: refusing on one line, a 486-character `did` on line 6, made every
`hand` verb exit 1 and the owner's floating card uncloseable by any verb.

Two consequences are the rule. An append is round-tripped through the reader first, so a row it could not read
back is `UNWRITABLE_ROW` and **nothing is appended**. And a **Done** marker whose step is not open is HELD while
any line was skipped: "no open step carries this id" is not conclusive then, and the owner's click is recorded nowhere else.

**The briefing COUNTS the skipped lines onto the page rather than refusing to render** (`--hand-steps` carries
`unreadable`, and the section renders on that count alone, naming `hand list`): refusing would take the second
surface away as the note sticks, and silence would read as "nothing is waiting on you".

Repair is an append, never an edit: settle the row, or post the step again. An unreadable line whose step a
LATER readable line already settled is retired with `slopweaver hand line-retire` (preview, then `--apply
--source-sha256 <hex> --reason "<why>"`), never edited out: a sidecar row matched on line number and sha256, so
readers stop reporting it while those bytes hold.
