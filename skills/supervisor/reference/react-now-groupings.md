# react-now's two groupings, the open-pull-request cards, and the two instants

Bundled reference for the `supervisor` skill, linked from
[fleet-briefing-shape.md](fleet-briefing-shape.md). Loaded when you are composing the react-now block, not
on every turn.

## react-now has TWO GROUPINGS, and they are the AUDIENCE split

One block holds everything the owner reacts to, in one card shape. `reactNow` is an object with two arrays, and
which one a card sits in says who ELSE sees the work. The reason: work the owner's goals did not shape ends up
misaligned with them.

- **`teamFacing` renders FIRST.** The work reaches a colleague — a review, a Slack ask, a shared branch.
- **`meFacing` renders below.** Nobody else sees it: the owner's own tooling, the owner's own pages. It carries one extra
  refusal the other grouping does not — its `what` and its options may not end by putting the last step in
  the owner's own hands, and the form and `briefing check` refuse one that does — see
  [briefing-contract.md](briefing-contract.md) rule 2.

**The split declares AUDIENCE, never autonomy.** The fleet progresses the owner's own team-facing pull requests
itself and cards only what needs the owner's judgement (`AGENTS.md` rule 10). So never read permission, completion or urgency off the grouping:
`readiness` says whether a card is answerable, and the card's own words say what it wants.

## Four rules on FRAMING

The owner's ruling: a card must say in plain words what
the thing IS before it asks anything, exist only where the supervisor cannot decide, offer options the owner can pick
where they sit, and carry its own age. The criteria, the measurements and the break-glass are in
[card-framing](card-framing.md); two consequences land HERE, on how a
grouping's cards are composed.

**A me-facing card reporting work already done is often NOT a card at all.** Rule 2's hard half refuses a
question asking permission for what doctrine already authorises, and `--open-prs` cards every open pull request
by construction — so the me-facing PR card's `why you` must name the real warrant ("a change of approach is
yours to call and nothing else will catch it") rather than describe the situation. The deeper version: a leg that cards EVERY open pull request produces cards for decisions nobody needs the owner for
(the gap § Card only the owner's judgement calls names).

**The `hold, you will read <something> first` option is refused.** Four of the seven me-facing cards on
one measured page version closed with one. `if silent` already tells the owner what happens when the owner says nothing, so a
hold whose content is homework duplicates silence while adding a read. The right shape is no third option.

## Every card also declares whether it is THE OWNER'S TO ANSWER NOW

The briefing page tells the owner to react to a card, but on reading it the card says the session is still
working and it is not ready for a reaction. Such a card does not belong at the top: it makes the owner squint to
tell whether a card is ready to react to, while many cards underneath it probably are.

`readiness` is a second, independent declaration on every card — `{ "state": "ready" }`, or
`{ "state": "waiting", "session": "…", "event": "…" }` naming the session it waits on and the ONE event that
ends the wait. **Readiness outranks the grouping in the render order.** `briefing render` partitions the
block: every ready card first, in the two groupings' own order, then `<h3 id="react-now-waiting">waiting on a
session — nothing to answer yet</h3>` and every waiting card under it, muted rather than warn-accented and
each carrying its own `waiting on <session> · <event>` line. So a waiting team-facing card sits BELOW a ready
me-facing one — a card the owner cannot answer has no first-ness to claim — and the numbering runs across the whole
block, so card 1 is always one the owner can answer. `src/briefing/reactNowCard.ts` refuses a page arranged the other
way, which is what keeps a hand-written page honest.

**`ready` is a claim the card's own words can contradict, and that is the shape the owner actually met.** A card 1
once declared itself ready while its `what` said the session was still adopting four pull requests into one native
stack and rewriting a section. So the form and `briefing check` both refuse a card
declaring `ready` whose `what` says a fleet actor is still adopting, measuring, building or rewriting
something. The criterion is deliberately NARROW, unlike the own-hand rule's: a `what` legitimately reports
what the fleet has done all the time, and refusing "the session landed it" would push composers to write cards
that never say who acted. Only the progressive form with a fleet actor as its subject fires.
`src/briefing/cardReadiness.ts` carries the criterion and the measurement — across the whole supervisor-scratch
briefing archive, hundreds of cards across over a hundred form snapshots, about one in a hundred matching this
criterion, one of them ranked above several ready cards, and the owner's own card standing several consecutive
snapshots as card 1.

Omitting `readiness` reads as `ready`, the same default `openArtifacts` takes. The default is safe only because the contradiction refusal
above is what stops it becoming a false claim.

Caps: the `session` is 120 characters, the `event` one sentence of 30 words, and both count against the card's
own 200 words above the fold.

The order is STRUCTURE, not a convention: two arrays rather than one array with an `audience` field, so
team-facing-on-top is not something a renderer can forget. Each grouping's heading and its one-line contract
are the renderer's own words — a composer cannot write or soften them. `src/briefing/shape.ts` refuses a
page whose groupings render the wrong way round. The two together are capped at `REACT_NOW_MAX_CARDS` (50),
which is the owner's own number: react-now MAY run to about fifty cards when steers are owed, and that is the design
working rather than a wall. The same question may not appear in both groupings.

## Every open pull request gets a card, from the same run

`--open-prs` turns every open pull request in the `--your-list` document into a card naming its next step —
`ranked` and `dropped` alike, so a pull request sitting with a colleague is included rather than suppressed,
which is precisely the one a chase card exists for. MEASURED: dozens open on one repository at once.

**Less what the owner has already settled.** A row whose `standing` is `ruled` (a lock-in ruling still holds, by
identity or by the card's URL) or `in-flight` (a session is inside it) is held back and named on the
diagnostics; a `stacked` one is suppressed a step earlier, by the default-branch test below. MEASURED: seven of the eight cards the owner ruled on in
a row were already ruled, deferred, or stack members. So **record every ruling the owner gives on a card
through `slopweaver session-start lock-in --item <url> …` the same tick** — that, and nothing a composer
remembers, is what removes the card (briefing-contract rule 6).

Grouping is mechanical: the `review-state` recommendation that means nobody is ever asked to review — `self-merges`
(a repository whose sole codeowner is its sole author) — goes to `meFacing`; everything else is team-facing,
**except `stacked`, which gets no card at all**. The owner's ruling: nothing in a stack gets a review ask
until the bottom pull request lands, one at a time, so a card for a pull request whose base is not the default
branch would put a step in front of the owner that is not a step yet. The bottom pull request's card carries the whole
chain in its fold instead — the leg's own background names every pull request queued behind it — and that is where
the owner reads the stack. A `conflicting` pull request is team-facing whatever repository it is in, and it is hoisted
AHEAD of every review ask in that grouping: nothing else on it can happen until it is rebased (two CONFLICTING pull requests had once been carded as "land it yourself"). **The rebase itself is the fleet's to
do**, not the owner's to approve before a force push, per rule 10. Composed cards keep their place ahead of the projected
ones inside each grouping. The act on each card is `session-start`'s own `doneWhen`, never recomposed; the card's
fold carries it whole and its subject line links the pull request with its title.

## Card only the owner's judgement calls

`github landing` gives every open pull request a DISPATCH verdict: the supervisor dispatches to a spawned agent
and cards ONLY the pull requests whose verdict is `needs-owner-judgment`, HIGH on react-now. That settles the earlier
rule that every open pull request gets a card, as **card
only the owner's judgement calls** (`AGENTS.md` rule 10). Every verdict but `needs-owner-judgment` —
`draft-first-review-ask` and `finish-or-card-close` included — is dispatched: a seat records its own `handover
ask --action` card where the owner's yes is needed, or, for a first ask, parks a `slack draft record` draft (the ask, or a
discussion opener where nothing agreed the change and it is no obvious bug).

**Two things wait on the owner's queue even when the pull request's own work is dispatched** (the owner's
word): a Slack message to a person that nobody asked for — a `resolve-then-bump` seat's chase is
the common one, parked with `slack draft record` — and a Linear closure that is arguable. The pull request
itself is never held: a red or behind head with a review ask out is fixed unasked, and carding it is the
defect the owner named.

Two facts a composer needs:

- **`HIGH` has no schema-level meaning.** Cards carry a grouping and a `readiness`, and nothing else;
  `src/sessionStart/githubLegReadings.ts` deliberately assigns GitHub rows priority zero because GitHub state is not
  owner-set urgency. So HIGH is expressed as **the first ready card in `teamFacing`**; no severity field exists.
- **The projection does not filter by dispatch verdict — a known gap, not a claim.** These cards are
  projected from `session-start --json` through `src/briefing/openPrCards.ts`; the dispatch verdict is
  computed by `github landing`, which that pipeline does not read, so `--open-prs` cards every open pull
  request. No card's copy says the owner's approval is awaited, that silence holds the work, or that a conflict
  resolution needs the owner's sign-off. Closing the gap crosses session-start serialisation, the card projection,
  the renderer and their tests; a second dispatcher inside `openPrCards.ts` is NOT the way, because that
  module projects `session-start`'s own act by design and a second opinion there would drift from the first.

## A bot turn blocked on the owner is a team-facing card, and the gate refuses a page without one

When a bot turn stops on a step only the owner can do — a sign-in, or a risky act the owner
approves before the bot does it — the block reaches the owner HERE and nowhere else: on the owner's react-now in
the fleet briefing, one of the places the owner looks most, and explicitly not the bot DM, which holds so much
that the owner never really looks at it.

`slopweaver turn blocked --json` is the source and `briefing check` is the enforcement: a page whose react-now
block does not LINK every `waiting` thread is refused, matched on the permalink token the verb prints. Linking
rather than merely mentioning is the point — a card telling the owner a turn is waiting on a sign-in without a link
to the thread makes the owner go and find it, which is the context switch the whole feature exists to remove.

**`teamFacing`**, because a colleague asked the question and is watching the thread; the work reaches them,
which is this grouping's own test. Three things a card here may never do: state or imply when the owner will get to
it (there is no clock on this state at all — it might be one minute, it might be one week), read as a failure
of the bot (the bot has not failed), or card a `ready-to-resume`
row, which is a thing the owner has already done. The card leaves the page when the loop session resumes the turn,
not when the owner reacts — so `lock-in` is not how one is closed.

## The eyebrow's two instants are FIELDS the verb fills

The owner must never have to ask whether the page being read is up to date, because that hurts trust in the very
thing the owner reacts to. So no composer writes the header's instants.
`briefing render` stamps `refreshedIso` (the newest recorded pass's own
finalisation, or this render with no `--ticks`) and `readyIso` (this render's) and REFUSES a form that writes
either, and the eyebrow states both exactly as `last refreshed <stamp> · ready for review <stamp>`. Two facts
rather than one, because a page rendered a minute ago over a pass recorded four hours ago is stale in the only
sense the owner cares about. A snapshot the page is built from is never the eyebrow's instant: the owner's list states its
own age in its section, a stale one adds the eyebrow's red clause, and every card is aged and gated against
`readyIso`, so a card read after a day-old list is never refused as dated in the future.
