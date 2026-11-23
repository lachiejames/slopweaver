# The fleet briefing artifact's compact HTML shape

Bundled reference for the `supervisor` skill. Loaded when § Fleet briefing links here, not on every turn.

## Render it, never write it

```
slopweaver session-start --json --no-record > run.json              # one run feeds the list AND the cards
slopweaver knowledge quiz --sweep <tick-id>                          # cut this sweep's question — EVERY sweep
slopweaver briefing render --form - --your-list run.json --open-prs --knowledge-quiz --sweep <tick-id> --out <html> < <form.json>
slopweaver briefing corrections --artifact <id> --page <html>       # where it moved — corrections.md
slopweaver briefing check <html>                                    # the reader, for a page you did not render
slopweaver briefing freeze --artifact "$(cat <id-file>)" --page <html>  # after the publish, EVERY time
slopweaver briefing sweep-block --form <form.json> --fold <text>    # each sweep's form edit; fold-caps, recut — verbs.md
```

**The page comes out of a typed form, and the form is the thing you edit between sweeps.** A typed form is
the right shape for this. Keep `form.json` in the scratchpad and edit it only through the `briefing` verbs —
no script, no Python. The schema (`src/outbound/briefing/schema.ts`) refuses before any bytes exist.

The form is the SAME fold discipline the pull-request body uses
([pull-requests](../../github/reference/pull-requests.md)) — outcome above the fold, evidence and provenance folded,
every above-the-fold cell capped and voice-gated. On a card that means the six fields are the outcome and `detail` is
the fold; below the line a note is a `headline` plus its own fold — or, carrying `lane: "quoted"`, a headline plus a
fold holding text nobody here composed ([section-quality.md](section-quality.md)). `render` runs the voice half over what it just
built, so the `voice-rules` hatch applies to it exactly as it does to `github pr`.

**The form's shape**, top to bottom:

| Field          | What it carries                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `header`       | `workspace`, `handoff`, `model`, `pinnedAt`, `sleeping`, the one-line `lede` — NEVER the two instants                                                                                                                  |
| `reactNow`     | `teamFacing`, `meFacing`, and `openArtifacts` — the ranked index of every page open on the owner                                                                                                                       |
| `yourList`     | THE OWNER's list — NEVER written here; filled by `--your-list` ([one-index.md](one-index.md))                                                                                                                          |
| `awaiting`     | REQUIRED, may be empty — renders nothing ([one-index.md](one-index.md))                                                                                                                                                |
| `alignment`    | REQUIRED — work-versus-board: `headline`, the folded `intake`, plus an optional `detail` fold                                                                                                                          |
| `autonomy`     | done without asking — NEVER written here; filled by `--autonomy-ledger` ([autonomy-ledger.md](autonomy-ledger.md))                                                                                                     |
| `handSteps`    | steps waiting on the OWNER's hands, each with its command — NEVER written here; filled by `--hand-steps` ([hand](../../hand/SKILL.md))                                                                                 |
| `ownerBeliefs` | what the fleet thinks the owner believes — NEVER written here; filled by `--owner-beliefs` ([owner-beliefs.md](owner-beliefs.md))                                                                                      |
| `quiz`         | one thing the fleet learned — NEVER written here; filled by `--knowledge-quiz --sweep <tick-id>` ([owner-beliefs.md](owner-beliefs.md))                                                                                |
| `nothingStale` | known stale across five surfaces, id `nothing-stale` — NEVER written here; filled by `--nothing-stale`, which `tick close` passes ([reader](../../automation/reference/hygiene-documents.md#the-nothing-stale-reader)) |
| `recent`       | landings under "done since you last looked" — or projected by `--ticks` ([derived-narrative.md](derived-narrative.md))                                                                                                 |
| `earlierToday` | one collapsed section of at most `SECTION_MAX_NOTES` (30) notes — or projected by `--ticks`                                                                                                                            |
| `history`      | at most `HISTORY_MAX_SECTIONS` (4) collapsed sections of 30 notes each — or projected by `--ticks`                                                                                                                     |

A cell is a list of runs (`text`, `strong`, `code`, `link`, `anchor`) rather than a string, because the renderer owns
every tag — why nothing in the form can emit markup or move its own words above the fold. A fold holds `para`,
`list`, `image`, `draft`, `paste` and nested `fold` blocks; a numbered set is a `list`; a value the owner must COPY is a
[`paste`](paste-blocks.md); how a fold READS is [readability](briefing-readability.md). An unknown key is REFUSED.

## Every card declares whether it is THE OWNER'S TO ANSWER NOW

`readiness` is `{ "state": "ready" }` or `{ "state": "waiting", "session": "…", "event": "…" }`, and it decides
where the card renders: every ready card sits above every waiting one, and the waiting ones sit under
`<h3 id="react-now-waiting">` with their own contract line. Without it the owner squints
to work out which of the top cards can actually be answered. **`ready` is a claim the card's own words can
contradict**, so the form and `briefing check` both refuse a card declaring `ready` whose `what` says a fleet
actor is still adopting, measuring, building or rewriting. Omitting the field reads as `ready`. The criterion, the measurement and the caps: [react-now-groupings.md](react-now-groupings.md).

## react-now has TWO GROUPINGS, and every open pull request gets a card

`reactNow` is `{ "teamFacing": […], "meFacing": […], "openArtifacts": […] }`, team-facing rendered FIRST, and
which grouping a card sits in is its AUDIENCE and nothing else: team-facing has a colleague on the other end,
me-facing reaches nobody but the owner. It declares no autonomy (`AGENTS.md` rule 10),
so never read permission, completion or urgency off it. **Readiness outranks the grouping in the render
order** — a waiting team-facing card sits below a ready me-facing one, because a card the owner cannot answer has no
first-ness to claim. `--open-prs` fills both from the `--your-list` document, one card per open pull request.
`openArtifacts` is the ranked index of every page a session left open on the owner, its validity marks derived from
the lock-in ledger rather than composed. The eyebrow's two instants are fields the verb
stamps and a form may not write. The rulings and the caps:
[react-now-groupings.md](react-now-groupings.md), [one-index.md](one-index.md).

## Images, drafts and pastes render INSIDE the card

A screenshot, a drafted Slack message or a value the owner must copy is shown in the card's fold as the surface itself would
show it, never as a file path the owner has to go find. The `image` and `draft` block kinds, the
text-then-images order and both size caps are [card-media.md](card-media.md); a `paste` is [paste-blocks.md](paste-blocks.md).

## The page never truncates, and a fold link always carries a title beside its key

A session-start row once cut a headline mid-sentence and left the
rest nowhere, so nothing here is cut with an ellipsis that drops the rest. The form refuses any run — a cell, a
fold paragraph, a list item, a fold's own `summary` — ending in `…` or `...`; write it whole and fold it
behind a `detail` if it runs long. `briefing check` carries the same rule over a page it did not render.

A fold's own link naming a ticket or pull request carries its title beside the key — `{ "kind": "link",
"text": "#<n> the render verb", "url": "…" }`, never `{ "text": "#<n>" }` alone. The form refuses a fold link
whose visible text is the bare key; a card's short above-the-fold cells are exempt — a citation lives in the
fold, not in six words a reader cannot avoid.

A pull request in a note is `owner/repo#<n>`. A bare `#<n>` resolves against the nearest GitHub link in its OWN
entry, else the page, where two repositories refuse it. `tick close` writes back qualified each one a passing page
resolved (`src/briefing/qualifyBareRefs.ts`); one split across a text and a strong run stays bare, so write it whole.

## The page it emits

Not a fresh design each time — one republished artifact, same URL for the whole run (never a new one per
sweep, so a bookmark or a Slack link the owner saved stays valid):

- **Header eyebrow**: `<session> · last refreshed <stamp> · ready for review <stamp> · refreshed every
sweep` — rule 7's staleness signal, both instants stamped by the verb on every render. **A snapshot half past ninety minutes REFUSES the render** (`src/briefing/snapshotAge.ts`, measured): `--your-list`'s own `nowIso` and the `--open-artifacts` file's mtime are both judged against the render's clock, so a fifteen-hour-old list cannot sit under a current-looking header again. `slopweaver hatch open stale-snapshot` publishes anyway and stamps each stale half's age in red in this same eyebrow — the hatch never makes the staleness invisible. `supervisor tick close` therefore regenerates `run.json` every sweep — through its own budgeted `session-start` child, or from a list the chair built bare and handed in with `--your-list` when that child overran under load; both face the same ninety-minute door — and re-stamps `open-pages.json` when `tick.json` says `openPagesReviewed`; a page it skipped says so instead of lying.
- **React-now block, FIRST on the page**: the two `<h3>` groupings, team-facing then me-facing, each with its own
  contract line; one card per open item, warn-accented, holding the bolded question, the linked subject line and a
  what/why/options/lean grid; `--open-page-cards` gives every open page ONE card, folding away a second for a page
  the block already cards ([open-page-cards](open-page-cards.md)). Below both, `react-now-waiting` holds every card
  waiting on a session, muted rather than warn-accented; under them `react-now-artifacts` holds the ranked index of
  every page open on the owner ([one-index.md](one-index.md)). An empty block ("nothing open above the line right now") is
  a real state, never omitted. Above it: only the eyebrow, title and lede.
- **The owner's side of the register, DIRECTLY below react-now**: the correction block, then the quiz.
  Both PROJECTED, never composed: [owner-beliefs.md](owner-beliefs.md).
- **Alignment line**: `<h2>what the fleet is working on</h2>` and one sentence under it, stating ONE number to chase and what it means. REQUIRED on every
  page — a form without `alignment` does not render, and `briefing check` refuses a page carrying no such
  block. Fill BOTH required fields from `slopweaver handover reconcile --json`, never compose either:
  `headline` → `alignment.headline`, capped and above the fold; `intakeClause` → `alignment.intake`, which
  the renderer folds so it never counts against that cap. What that verb ranks and what each field owes:
  [one-board.md](../../handover/reference/one-board.md). When work drifts from
  what the owner wants done, the owner gives the same feedback repeatedly, and that is the time for a mechanical
  fix — the sweep is FORCED to state it by the schema.
- **Your list, and the artifacts you are being sent to**: the owner's queue is projected BELOW the cards inside a
  fold stating how old the read is, and the artifact block sits at the foot, each with its own budget and
  `id` — both [one-index.md](one-index.md), the ruling that made this page the single index.
- **Folded reference**: everything below the line lives in collapsed `<details>` sections, one per category
  (today's rulings, landings, live fleet, traps), expanded only if the owner opens one.
- **Width**: `main` is `max-width: min(88vw, 140ch)` and paragraphs carry no narrower cap of their own. Everything at 50% width reads as skinny, and 80-90% is more readable.
- Load `artifact-design` before authoring or updating it, as with any artifact — this contract fixes the
  CONTENT shape and the width above, not the rest of the visual design pass.

## Fold first, then write — the fold has a SHAPE rule, and no word count

Compose every card as the short version plus a `<details>` inside the field that needs the depth: every
above-the-fold cap is measured with each `<details>` body removed. Inside a fold the only thing counted is
BLOCKS, four at every level of nesting, and no paragraph carries a word cap. The whole
rule, and why there is no per-cell cap: [readability](briefing-readability.md).

## The gate, whichever door the page came through

`briefing render` runs it over its own output and refuses rather than writing `--out` (the refused page lands in
`<name>.refused.html`, `tick close`'s included; a bare reference names its card, or section and fold); `briefing
check <html>` is the reader for a page it did not render (`--home` reads another home's rules). Three things only the check can see survive there rather than in the schema: an option naming a
Title-Case label the card never defines, a cross-field relation and not a cap; the operator's private voice rules,
which a schema shipped here cannot read; and whether a card's pull request has merged, closed or queued since
([card-freshness.md](card-freshness.md)). Two refuse an OMISSION: [omission-gates.md](omission-gates.md).

**And one thing only the SCHEMA can see: what is INSIDE a fold.** `check` reads rendered HTML, where a
composed fold and a projection of the owner's own recorded question are the same element, so it is silent on a fold's
block count by construction rather than by omission ([readability](briefing-readability.md) § 5).

Prose stating a shape is ignorable — a "be concise" ask once compressed three react-now cards to one line
each and nobody noticed, and the first version of this gate then passed a card whose `what` ran to 496
words. **A refusal means fix the card**; the output names the card, the field, the count and the cap.

**Every OTHER section reads the way a gated card does** — [section-quality](section-quality.md).

**Card shape.** A one-sentence question ending in `?`; a `what` carrying at least two sentences of
background; `why you`; `options` shaped `A: … B: …` where every option is a full sentence with no undefined
label; `lean`; `if silent`; a `readiness`; a `premise`. Four more rules govern FRAMING and age: [card-framing](card-framing.md). **A card that declares itself ready while its `what` says a session
is still working is refused, and a waiting card ranked above a ready one is refused** — that is the readiness
rule above. **An option and `if silent` route the owner to the supervisor chat and nowhere else** — a `reply`, `react` or `DM card` in either is refused unless it names the supervisor (the owner only speaks to the supervisor), so an option reads "tell the supervisor <word>". **A me-facing card's `what` and options never put an action in the owner's own hands** — "then you reset", "in your own file", "only you can write", "add it now" are refused, because the owner does not touch their own code or config; name the session as the actor instead. **A me-facing card names above the fold every command the owner has to type** — a `code` run of two or more tokens opening on a known command head, sitting only inside `detail`, is refused by name (a card whose commands sat only in its fold left the owner hunting for them); if surfacing one runs `what` over its cap, fold the other prose, never the command (`src/briefing/commandAboveFold.ts`). Optionally a `subject` — `{ "text": "#<n> the thing it is about", "url": "…" }` — which renders as the title line under the question, outside the field grid so the voice pass never reads it: a title is the SUBJECT's own words, and a colleague's ordinary `feat: a, b and c` would otherwise refuse the whole page over one commit message. Its words still count against the card's 200. **A `subject.url` may never point at a briefing page's own fixed section** (`#react-now`, `#alignment`, `#recent` and their siblings, whosever page) — a block of cards is nothing a card is ABOUT, and when it is this page it sends the owner back to what the owner is reading; an `anchor` run is how you move the owner within the page. A composer's own section id is deliberately not caught, since another page may carry the same one. **A subject with no page of its own drops `url` and begins its `text` with `no page`**, and owes a `detail` fold: naming the absence of a page is the opposite of somewhere to go. **A `subject.url` is never a markdown document** — a finding links the page its seat published with `slopweaver page publish`, never its `handovers/<slug>.md`, in either grouping (a markdown file is not easy for the owner to react to); the render, the form and `briefing check` all refuse one, and [finding-page.md](../../handover/reference/finding-page.md) says what the page carries.

**Hard caps, all measured above the fold** (`src/briefing/caps.ts` carries the measurement each came from):

| Field                        | Cap                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| question                     | 1 sentence, 30 words                                                                                                            |
| what                         | 2 to 4 sentences, 60 words — and, by import, a drafted Slack action's body ([ask-shape](../../handover/reference/ask-shape.md)) |
| why you                      | 1 sentence, 30 words                                                                                                            |
| lean / if silent             | 2 sentences, 30 words each                                                                                                      |
| each option                  | 1 sentence, 25 words                                                                                                            |
| options                      | at most 4, lettered A to D                                                                                                      |
| a recent block               | 60 words, 4 sentences                                                                                                           |
| a waiting card's session     | 120 characters                                                                                                                  |
| a waiting card's event       | 1 sentence, 30 words                                                                                                            |
| the whole card               | 200 words, subject and wait line included                                                                                       |
| the react-now block          | 50 cards across both groupings                                                                                                  |
| any paragraph above the fold | 4 sentences                                                                                                                     |
| inside a fold                | no word or sentence cap at all                                                                                                  |
| one fold                     | 4 blocks, every level, nested 2 deep                                                                                            |
| any paragraph, folded or not | at most 2 inline numbers                                                                                                        |
| the page OUTSIDE the cards   | 1000 words, 5 unfolded blocks                                                                                                   |
| your list                    | 10 rows, 300 words, 30 each                                                                                                     |
| the artifacts linked         | 3, one sentence of 30 each                                                                                                      |
| the lede                     | 4 sentences, 60 words                                                                                                           |

**Both page budgets read the same region: everything OUTSIDE the react-now block.** A word total counting the cards
would refuse the owner's own fifty-card design at the eighth. So a
card is bounded by its own 200, the block by a count of cards, everything else by the 1000. A done or landed list
grows one block per sweep, so fold the older ones behind a collapsed `<details>` or drop them — one such
list once reached 129 unfolded blocks and 12,351 words.

**A numbered set of items is a real list** — the OPTIONS cell included, one `<li>` each, never "1 x. 2 y."
packed into a paragraph, because run-on sentences read badly. Long fold bodies get real `<p>` paragraphs for the same reason, which is also what lets
the gate read them at all.

**The voice rules apply to every field above the fold**, the same ones every other outbound door runs: no colon-
introduced list, no semicolon welding two facts, at most one parenthetical aside, no sentence over 30 words, and the
operator's own private word rules from `profile.json`. An option's `A:` letter is structure rather than prose and is
never read as a colon list. The `voice-rules` hatch lifts the voice half for one deliberate exception and
never lifts a cap.
