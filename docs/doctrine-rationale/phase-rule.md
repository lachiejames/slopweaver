# Phase rule · Propose-then-react

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

**Not doctrine. A PHASE rule, and it names what ends it.** Where it should live had three options: **A** a
standing doctrine line in `AGENTS.md`, **B** the same text carried as a phase rule that names what ends it,
**C** neither yet, leave it on the row until a real case has run through the gate. The owner took B, as the
briefing card leaned, recorded as a lock-in `approved-as-proposed` in
`$SLOPWEAVER_HOME/ledgers/session-start/lock-in.jsonl`. A is what the owner declined, so a later pass promoting
this into the numbered doctrine has reversed the owner's ruling rather than tidied it.

## What the owner asked for

The rule answers a reaction the owner gave to the flywheel page, and that reaction is the anchor to re-read
before changing a word of this section (`$SLOPWEAVER_HOME/handovers/archive/`, the flywheel-reaction turn).

Disagreements matter, but other people's feedback must not immediately rewrite what is being built. While the
work is still being tested out, feedback comes in, the session proposes changes in an artifact, the owner
reacts to the proposal, and then the fleet acts. The fear is concrete: a session answers a question, someone
gives feedback, the session interprets it in a way the owner would not have, and then acts in a way the owner
disagrees with. That is what the owner wants avoided, especially this early in what is being built.

Asked whether the proposal register could carry that traffic, the owner allowed it might — with the same caveat:
the owner reviews and reacts before anyone applies feedback, never a blind apply.

## The rule

**Outside feedback never rewrites what we are building, or how we work, directly.** Feedback comes in; the
change it argues for goes into an artifact as a PROPOSAL; the owner reacts; then we act on the owner's
reaction. Recording feedback is not accepting it, and answering the person who gave it is not adopting it —
`proposal record-feedback` and `answer-feedback` move a debt, never a decision.

**The phase it binds** is the one named twice above: while the owner and the fleet are still testing things
out, and still early in what they are building. The risk is specific and is the thing to hold on to when the
letter of the rule is unclear — that a session reads someone else's feedback into a change the owner would not
have made, and the misreading is invisible to the owner because it has already shipped.

## What ENDS it

**The owner retires or replaces it, and that decision is recorded HERE with its anchor.** Nothing else ends
it: not elapsed time, not silence, not an empty `proposal feedback --unanswered` queue, and not rule 10.

**What triggers the ASK is the first real case running the whole loop end to end** — feedback recorded, a
proposal put to the owner, the owner's reaction, and the resulting act or disposition. That was option C's
condition, which the owner passed over, so it is the moment to put the question back to the owner rather than
a licence to retire the rule unasked. A session that finds this rule still standing after such a case cards
it; it does not settle it.

That structure is how option B is implemented rather than something the owner dictated: the owner ruled that
the rule must name what ends it, and the naming above is this document's own.

## Reconciling with rule 10, which landed the same day

[Rule 10](rule-10.md) says obvious acts are TAKEN and ledgered rather than proposed first.
The two do not overlap, and the axis is **whether the ask changes the direction the owner already agreed**:

- **An ask that lands INSIDE that direction** → [rule 10](rule-10.md). Obvious to a session that knows the
  owner: do it, and record it in the autonomy ledger (`slopweaver autonomy record`) with why it was obvious.
  The owner's own named list is in that rule — CodeRabbit changes, pull-request comments, red CI, conflicts,
  rebases, restacks, and merging or enqueueing a mergeable pull request. A reviewer asking for a change inside
  work the owner already agreed to is that, not feedback in this rule's sense: the direction was settled
  before the comment arrived.
- **An ask that CHANGES that direction, on someone's feedback** → this rule. The artifact, the owner's
  reaction, then the act — even when the change looks obvious, because "obvious" is exactly the judgement the
  owner does not want a session making on someone else's behalf. What changes here is what we are building or
  how we work, not how far along an agreed piece of it is.

**Unclear which side a thing sits on → card it**, as both rules already say for their own uncertain cases.
Neither route widens `cross-session-messages.md`'s tier-3 set, and neither touches the finding gate: a
`handover register --finding` row still holds its team-facing output until the owner says they want the work.

This is a criterion, not a permission table. [Rule 10's own examples](rule-10-examples.md) exist only because
the owner asked for them, and each is a prior word of the owner's — the two bullets above name an axis, and
the only enumeration in them is the owner's own.

## The consequence it already had

Option B on the flywheel page's capability 2 — reuse the proposal register for pain-points replies — is **not
accepted as written**. It needs this gate between recording feedback and acting on it. The register itself is
untouched by the ruling: its statuses, its `unanswered` definition and its events all stand.

## What was checked, and when

MEASURED in this checkout when the phase rule was placed, and it is why the rule had still never been
exercised: `slopweaver proposal list` → 16 proposals; `slopweaver proposal feedback` → **zero** feedback
events; `slopweaver proposal feedback --unanswered` → zero. The same counts stood when the rule was first
stated. A rule that has never fired is the reason the ending condition is a trigger to ASK rather than a test
that could quietly pass.
