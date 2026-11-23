# The autonomy ledger on the briefing — done for you, without asking

The Fleet Briefing's fourth section: every act the fleet took under graduated autonomy, newest first, one
line each, with the reasoning and the witness folded.

## What it is FOR, which is not what a log is for

A ledger like the react-now page, but simpler, showing what the fleet took under graduated autonomy. The owner reads
this briefing many times a day, so it is where the owner can give a retroactive steer: on something the owner would
have been fine with that the fleet did not do, or something it did do that the owner was not fine with.

Three consequences, and each is a rule rather than a note:

- **It lives on THIS page**, because this is the page the owner reads many times a day. A ledger on its own
  artifact is one the owner would look at on the day it was built.
- **It is not folded away.** Every other section below the cards is behind a fold; this one is not, because
  a steering surface the owner does not meet is a steering surface that collects nothing.
- **It is simpler than a card.** One line, the object acted on, an instant, a session. No question, no
  options, no lean — there is nothing to answer, only something to disagree with.

## You cannot compose it

`briefing render` REFUSES a form that writes `autonomy` itself. The section is a projection of the store's
autonomy ledger (`src/autonomy/port.ts`), which every session acting under graduated autonomy appends to,
and a supervisor free to retype a row could disagree with what the acting session actually recorded — which
would leave the owner steering an account of an act rather than the act.

```bash
slopweaver briefing render --form - --your-list ./list.json --open-prs \
  --open-artifacts ./pages.json --open-page-cards \
  --autonomy-ledger \
  --out ~/.slopweaver/published-pages/fleet-briefing.html
```

`--autonomy-ledger` reads the store's ledger for the state home — no path, because there is exactly one ledger
and a flag taking a path would invite a sweep to render one copy of it while the fleet appends to another. A
store that cannot be read refuses the render rather than drawing an empty section.

**Omitting the flag renders no section at all**, which is a real state (a sweep that did not ask for it) and
NOT the same as an empty register (an install where nothing has been done autonomously, which renders no
section either but for an honest reason). `briefing check`'s summary line says it cannot tell the two apart
from the bytes — if you meant to show the ledger, look for the heading rather than trusting a clean run.

## What a row shows the owner, and what it holds back

Above the line: **what** was done, **on which object** (by its own short name), **when** (the owner's own clock),
**by which session** (its workspace). Behind the fold, in this order: the **said**, then the **why**, the
**witness**, the object's full reference, the full session name and the **act id**.

**The said opens the fold and the why sits under it**, because they are two accounts of one act written for
two readers: the said is in the owner's words, the why is the fleet's note for the next session. The said is inside
the fold rather than on the visible line for a budget reason and not a ranking one — `autonomyRowAboveFoldWords`
counts the visible line, and a sentence per act would spend the page's shared budget on one section. It is
also the one folded field with a CAP, because the register refuses a longer one at the door. A row with no
said renders none; the fold opens on the why.

**Only a URL subject is a link.** A row's subject is a checkable id in one of three forms — an absolute
http(s) URL, a handover board row slug, or `state:<path>` for a file under the state home — and the other
two render as `<code>` rather than as an anchor, because a link that scrolls nowhere teaches the owner to distrust
every other link in the section. The full reference is in the fold either way. Why the field is not
URL-only, with the measurement: `src/autonomy/subject.ts`.

The act id in the fold is the affordance. The owner does not run commands off this page — the owner tells you, and you run
`slopweaver autonomy steer <actionId> --steer "<the owner's words>" --by-session <you>`. Record the owner's words as close
to verbatim as you can; a paraphrase is where a preference quietly becomes something else. The row then
renders **you have steered this** and carries the owner's word in its fold.

The owner also gives a word on an act in the box on its card on the console's
[Alignment page](../../../docs/console/alignment.md), which runs the same `autonomy steer` for the owner with
`--by-session work-console`. A steer row you did not write is that, and is recorded as the owner gave it.

## Reading it during a sweep

`slopweaver autonomy list --unsteered` is the sweep's own question: what has the fleet done that the owner has not
reacted to. It is not a queue to drain and it never becomes a card — the owner steers when they happen to read it,
and the register remembers until the owner does.

A REFUSED act is a real row and renders as one. `press-merge-when-ready-refused` says exactly that, and the
renderer never presents one as a success. Do not tidy those out of the owner's view: an act the fleet tried and
could not complete is one of the things the owner asked to be able to steer.

## It can make a composed card's bare reference stop resolving

`src/briefing/bareRef.ts` resolves a bare `#<n>` only while the whole PAGE names exactly one repository. An
act on a repository no card mentions adds a second one, and the gate then correctly refuses the bare
reference somebody wrote in a card. It is the gate working rather than a regression: with two repositories
on the page, `#<n>` genuinely is ambiguous. Write the card's reference as `owner/repo#<n>` — never reach for
the `bare-refs` hatch, and never drop the ledger row to make a card's shorthand survive.

## The caps

Ten acts on the page, the rest counted honestly as `N earlier act(s) not shown`. The three visible labels
are bounded; the why, the witness and the owner's own words are not, because they sit in a fold nothing forces the owner
through — the fold ruling. `src/briefing/caps.ts` carries the numbers and
`src/briefing/autonomyCheck.ts` reads them back off the rendered page.

The section's visible lines ARE charged against the page's above-the-fold word budget, unlike the ranked
open-artifact index one section up. The index sits INSIDE the react-now block, which that budget excludes
wholesale; this is a sibling of the alignment line, so its words are words the rendered-bytes half already
counts. If the page runs over, shorten the lede or fold a recent block — never the ledger.

## When the whole section disappears

The register's reader REFUSES a malformed line rather than skipping it, so one bad row takes the section off
the page and `briefing render` says why, naming the line. That is the design — a page reporting "nothing was
done under autonomy" because a read failed is the confident wrong answer this section exists to prevent —
and the repair is `slopweaver autonomy adopt`, which reports what it would change and writes nothing until
`--apply`.

## Where the rest is

- The verbs, and what a session acting under autonomy owes this register:
  [the autonomy skill](../../autonomy/SKILL.md).
- The whole page's typed shape: [fleet-briefing-shape.md](fleet-briefing-shape.md).
