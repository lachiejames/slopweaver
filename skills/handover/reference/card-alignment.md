# A question lines up with the card drawn from it

A card has to link to the PR diff and has to ask something: a card that only says "I did this" leaves the owner
asking what it is even asking for. One corrected question opened "The slopweaver half has LANDED — #<n> merged …":
a statement as the heading, and a pull request with no link.

## What `handover ask`, `handover correct` and `handover register` refuse

`ask` and `correct` judge the `--question` TEXT before anything is journalled (`src/handover/cardAlignment.ts`);
`register` judges its `--ask` the same way on a row that waits on the owner's word (no `--dispatch`, and no `--finding`
unless it carries a shape), because that text is the card's title; it writes the ask as one line, so the card
splits the sentences the gate judged. A row registered as "yes to the exact Vanta write that reactivates a named
CVE …" reads as unparseable prose. Write the ask as the question the owner answers: what, why now, what yes does, what happens after.

- **The lead asks.** One of its first TWO sentences ends in `?`. The drawer's heading is exactly that
  sentence (`leadQuestion`, `site/lib/queueCardAsk.ts`), so a question that opens on a report becomes a heading
  that tells the owner something. Open on the one thing the owner is being asked to answer; the background follows it.
- **A named pull request carries its URL, in the question itself.** `#<n>`, `PR <n>`, `PR #<n>` or
  `pull request <n>` needs its `https://github.com/<owner>/<repo>/pull/<n>` in the same text. The card draws
  a pull request as its number, the number the link (`site/lib/inlineCitations.ts`), resolved from the
  question's own URLs and `prUrls` — which `handover list --json` scrapes from the doc summary, the question
  and the reason, never from `--problem`, `--options` or `--lean` — so a link placed there leaves the number
  linking nowhere. `PR3` and `option #1` are positions, not pull requests, and are not read as either.
- **A command of the owner's sits on lines of its own.** The card lifts a paragraph — not the lead — whose every
  line opens on one of the owner's programs (`sudo`, `slopweaver`, `gcloud`, `op`, …: `OWNER_PROGRAMS`) into one copy
  block per line (`src/handover/commandParagraphs.ts`, mirrored by `site/lib/askCommands.ts`). One left inside a
  sentence is drawn as text the owner cannot copy, so it is refused; a sentence about a lifted command passes.
  Commands the owner needs to run go in copy blocks ([the checklist](../../hand/reference/checklist.md)).
- **The heading says what a thing is before it names its code.** A code its first two sentences name bare — a
  team key (`ABC-1`), an ISO clause, a section-number list (`2.1 and 3`), a hex, draft, review-pass or relay id
  — is refused; the same code in parentheses after the words saying what it is passes ("Asset inventory
  (ABC-1)"), and so does one in a URL (`src/briefing/untranslatedCode.ts`, shared with `hand post`'s headline).
  An owner cannot read a control name followed by "2.1 and 3" without asking what it means. MEASURED: 119 of 869 distinct question leads hit, every one a reword.
- **The heading leads with the discussion, never a pull request.** A lead opening on a GitHub pull, compare or
  branch link, a bare `#NN`, a numbered `PR <n>`, a `fix PR`/`fix branch`, or asking anyone to approve, review
  or merge a fix (`src/briefing/pullRequestLead.ts`, shared with `hand post`'s headline and `slack draft record`)
  is refused: open on what was noticed and its evidence, and the conversation to have. A card ABOUT a pull
  request the owner asked to see passes when it opens on words. Never lead
  with the PR instead of the discussion ([why](../../../docs/doctrine-rationale/rule-10-team-facing.md)).
- **A picture is attached, never named.** A token naming a `.png`, `.jpg`, `.jpeg`, `.webp` or `.gif` file — a
  path, a `~` path, a bare name or a URL (`src/handover/cardImage.ts`) — in the question, any shape field
  (problem, option, trade-off, lean, risk, blast radius, still-real), an `--example` scene or `--example-gap`
  line (`ask`, `register`, `example`) or a `reconfirm --still-real` line is refused, because the card draws it as a path the owner cannot see, and an image belongs on the queue card. Say in words what it shows, and attach it below. `hand post` refuses the same in a step's prose.

## Attaching the picture: `handover shot`

```bash
slopweaver handover shot <slug> --shot <png> --box x,y,width,height=<label> [--box …]
```

One to nine boxes in IMAGE pixels, each with a label of at most 60 characters — "stale", "missing", the number
to read — judged against the PNG's own size before anything is written; a picture with no `--box` is refused,
because the box is the point (a red box around the stale or missing item says it). The PNG is stored once by its SHA-256 in the hand-shot
store, then a run parked on the owner takes a `question-shot` journal line bound to the open question's text — a
re-ask or a reshape leaves it behind, a correction, reconfirm or offer keeps it — and a registered ask with no
run takes `shot:` in its front matter. It needs no claim, replaces any earlier picture, and refuses a row not
open on the owner. The Queue's ask card draws it with the hand step's overlay (`site/components/console/HandShot.tsx`).

MEASURED over every `question`/`question-corrected` event in `$SLOPWEAVER_HOME/runs`: 531 of 703
led with no `?` in their first two sentences, and 253 named a pull request without its URL. Every one is a
reword, not a lost card:

```text
REFUSED   The slopweaver half has LANDED — #<n> merged. Only the acme-admin base call is open. Say A or B.
RECORDED  Should the acme-admin half land on staging (A) or the personal base (B)? The slopweaver half merged
          as https://github.com/lachiejames/slopweaver/pull/<n>, so only this base call is open.
```

## The hatch, and what a card says without it

`SLOPWEAVER_ALLOW_UNALIGNED_CARD=1` records the question anyway. Its exceptions: a `#NN` that is not a
GitHub number, a run that must park now and genuinely asks nothing, and a picture file that is the subject
under discussion rather than a picture to show. A row recorded that way — or before
this gate — is headed by its lead **as written, never labelled**: a `No question stated:` prefix bolted onto a
statement read as nonsense, so the fix for such a row is rewording it, below. Every pull request a
card links is drawn with **its diff** beside it (`prDiffUrl`, `site/lib/askLinks.ts`).

## Aligning a row already on the queue

`handover correct <slug> --question "<question-led, URL-carrying>" --why "<what did not line up>" --still-real
"<the check, re-run>"` from the session holding the run (`handover claim` a released one first, `handover release`
after). Re-check every fact the new text states before writing it — a correction is the one place a stale number
is easiest to pin. `--still-real` is required while the card prints a check, and the refusal quotes it
([ask-stakes.md](ask-stakes.md)).
A row `register` wrote carries no journalled question, so its title is the doc's `summary:`: `handover correct`
rewrites that, its heading and the brief's copy together under the same gates, then `handover quote --apply` if
you gave it an anchor ([registered-ask-queue.md](registered-ask-queue.md)).

## Where a card says it came from

A row with an anchor names it; one with the owner's words quotes them. `register` also writes `registeredBy:` (the
session it ran in) and `registeredRun:` (the run that session held, found from the checkout's branch or
directory name and kept only when that run's journal names this session), so a card with no anchor says which
session put it on the owner's queue, and while running what (`site/lib/queueCardSource.ts`). Only a row older than
those fields still reads that nothing records where it came from.

**A Slack anchor's poster is the one the card says asked.** A card once said one colleague tagged a channel when the
anchor was another colleague's own review ask; the registering session had lifted the wrong name from inside the
message. So `register` reads
who posted a Slack `--anchor` off the local corpus (`src/cli/commands/handover/anchorAttributionGate.ts`) and
refuses an `--ask` or `--example` scene whose "X asked / tagged / posted" claims name Slack people but never
that poster — hatch `SLOPWEAVER_ALLOW_ANCHOR_ATTRIBUTION=1`. A scene naming the poster anywhere ("the poster's #<n>",
`@<poster>`) passes whole, a bot or a name Slack never saw is no claim, and words in double quotes are never one. A thread participant does not pass: anchor THEIR message
instead. A message no recent bronze window holds is registered unchecked, said in one line.
