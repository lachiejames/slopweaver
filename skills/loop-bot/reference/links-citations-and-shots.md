# What an answer OWES — deliverables, links, citations and screenshots

Ten refusals. The first two are decided by the question alone, the next two by WHERE the reply lands and
what it attaches, the next three answer an answer that showed several things
and proved none of them, the next asks whether a citation you DID attach opens on the thing it is offered as,
and the last two ask a number for the command that produced it and a small sample for its n.

Eight of the ten are `turn answer`'s alone. Two also stand at the BOT-CARD door: the **control-citation**
rule (`slack post|reply|update --as bot`, through `src/cli/citedControlsDoor.ts`), and the **picture
question**, on a card a session composed and only where it is first posted (`src/cli/cardPictureDoor.ts`).
A card a scheduled job derives is never asked it.

## Run the checks yourself, before review

Two commands, and they cover different halves — running one and calling it clear is how a composer still
arrives at review with a refusal waiting.

**`slopweaver turn answer --answer <file> --print-digest`** parses the form and sends NOTHING. It runs the
SCHEMA rules — the ones below that live in `parseAnswerArm`: sections 1, 2, 3, 5, 6, and the documents lane's own
extension list. A digest on stdout means those pass; anything else is the list of refusals, each naming its
own field path and remedy. MEASURED, and this is why it is the first section rather than a
footnote: a composer who reached this bar unaided still took three review rounds to get there, and two of the
three were spent discovering that the Details fold is in scope.

**`slopweaver turn review`** runs the DOOR gates — sections 0 and 0b, which read the question and the surface
and so cannot be decided from the answer's bytes alone — before it opens a reviewer. Its refusal is the
door's own, in the door's own words.

## 0 — two artifact classes the question itself demands

`turn answer` REFUSES a send that omits one (`src/admit/requestedDeliverables.ts`, break-glass
`answer.deliverable:v1`):

| the question says | the answer must carry                                                |
| ----------------- | -------------------------------------------------------------------- |
| deploy            | a labelled `link` run per deployed thing — a citation does not count |
| screenshot        | the images themselves in `images`, as absolute paths                 |

Your own `turn resume --dispatch <id>` prints this list for the ask you were dispatched for.

## 0b — a local PAGE is a deliverable for the OWNER, in a DM. Never for a room

**A page under `$SLOPWEAVER_HOME/pages/<slug>/` exists on the machine this bot runs on and nowhere else.**
In the owner's DM that is exactly right: it is the owner's laptop, the file is there, and `slopweaver page`
wrote it for the owner to open. In a channel it is a deliverable nobody in the thread can open, and saying where it is does not
change that.

MEASURED on ask `C0SYN000001/1789444110`, answered into a team channel with three colleagues in
the thread: the turn wrote four ISO pages and delivered a message saying nothing was uploaded anywhere and that
the four pages were files under `~/.slopweaver/pages/iso-*​/` on the owner's mac, with a four-row table of paths.
The pages had only been written locally, so the owner uploaded one by hand, and markdown would have been preferred.

So, in a room:

- **Attach the deliverable.** `documents` on the answer form takes up to two absolute paths — `.md`,
  `.markdown`, `.html` or `.htm` — and they upload in the thread with the reply, where everyone can open
  them. Anything else in that array is a schema refusal naming the lane it belongs to.
- **Markdown first, the rendered html second.** The owner can quote, diff and edit markdown in Slack and can only
  look at html. Html with no markdown beside it, or html listed first, is a `warn`
  (`answer.markdown-first:v1`). If only the page exists, write the markdown too — do not reach for the
  override to skip that.
- **Do not name the path.** A channel answer whose own text carries a `~/.slopweaver/pages/…`, an absolute
  path under a dotfile home, a `$SLOPWEAVER_HOME/pages/…` or a `file:///…/pages/<slug>/index.html` is a
  `warn` (`answer.local-page-path:v1`), and it fires whether or not you also attached the file. The
  override is for the one case where the path IS the answer — the owner asked where something landed.

Both refusals are `src/admit/documentDeliverableGate.ts`, in the deterministic gate list, so `turn review`'s
pre-flight catches them before a reviewer is ever opened. `--print-digest` does not: it never sees the
surface the reply lands on. The extension list IS a schema rule and `--print-digest` catches that one.

## The rule behind the next three refusals

Take an answer that listed five ISO "easiest wins" across nine control ids, every id plain text: none of the
links resolved. Every ticket should be a link, meaning just a hyperlink over the text; which control each item
refers to needs citations; five different quick wins call for screenshots; and an answer is not ready to post
without all of that, which applies to any message.

It is **structurally impossible** to repeat, so all three are `parseAnswerArm` refusals
(`src/outbound/assistant/answerForm.ts`, rules in `src/outbound/assistant/citedAndShown.ts`) rather than
review notes. You cannot ship past them by accident, and every refusal names its own break-glass in the line
that refuses.

## 1 — every ticket and control id is a hyperlink over its own text

Mostly not your job: the form resolves a `#<n>`, an `owner/repo#<n>`, a Linear key and a compliance control
id like `HRS-52` into a real `link` run on its own, before any refusal is considered. Two cases still reach
you.

- **A control the form knows but cannot address** is refused by name — the workspace slug it lives under did
  not resolve. Write the `link` run yourself, or fix the slug. Break-glass `slopweaver hatch open bare-refs --reason "<why>"`.
- **A control your install's atlas has never seen is INVISIBLE to the scan**, so nothing refuses and it ships
  as prose. If you are naming a control from outside the atlas, write the `link` run yourself. This is the
  one hole in the rule and it is stated rather than papered over.

A control is addressed by its PROVIDER id, never the id printed to a reader — `DCH-108` is `0syn0001` — so
never hand-assemble a control URL from the text. Take it from the atlas.

### The fold counts, and it is where this rule is actually broken

The rule scans the grounding's authored prose as well as `lead`, `body` and `index`, because all of it
renders to the reader in the Details fold. MEASURED on a real reviewed answer: ONE bare reference
above the fold and TEN below it, in `blindSpots`, a premise check's `subject` and `how`, a
`substitutedForReal.real`, `capability.what` and `result`. Across this install's posted answers, 4 of 13
carry one. It is the normal case, not an edge.

Two remedies, and the refusal tells you which one you are looking at:

- **An evidence or premise line left its own `url` empty.** Fill it in. The label then renders as that
  link's text and the reference is satisfied. A line that ALREADY has a url is never scanned, because its
  label is already a hyperlink.
- **A field with no url and no runs** — `blindSpots`, `couldNotSee.reason`, `capability.what`, `result`,
  `surface.what`, `why`, `substitutedForReal`. Name the object in `body` or `index` where a `link` run can
  carry it, and refer to it here without repeating the raw id.

`capability.command` is deliberately NOT scanned: it is a literal invocation, so a `#<n>` in it is an
argument rather than a citation.

## 2 — a control is cited in the SAME item that names it

Body and index only — the fold is scanned for LINKS, not for citations, because a blind spot is a caveat
rather than a claim needing evidence. The same paragraph, the same bullet, the same table ROW, the same index line. One shared `[n]` at the top of
an answer grounds the block it sits in and nothing else — that is exactly what the rejected answer did, and
the one citation it carried made it LOOK grounded while a five-row table beneath cited nothing.

A citation names a control two ways, either is enough:

- its `url` is that control's own page (the natural route — cite what you read), or
- its `sourceRef` is `{"source": "…", "id": "HRS-52"}` (the explicit route, available even where nothing
  knows the URL).

Break-glass `slopweaver hatch open uncited-controls --reason "<why>"`.

## 3 — three or more distinct references asks one question: which would a picture show better?

Counted across `body` and `index`, of every reference kind together — controls, Linear keys, GitHub numbers —
because those are the different THINGS the reader is being shown. At three, with no picture, the form is **held once**
on _"which of these would a picture show better than text?"_ A judgement, not a gate: what
deserves a picture only shows up during the investigation, so no rule fixed in advance can pick it.

Attach the picture that shows something the text cannot, as an absolute path in `images` — as many as earn
their place, with no ceiling, none that repeat the text. Or set `noPictureBecause` to why none adds
value; the send's door-ledger row records it as an `unshown-items` acknowledgement, so an answer that always
says "none" is findable. A reason where no question was asked is refused.

**`slopweaver browser shot --url <address> --out <file.png>` takes one** through the owner's own Chrome; its states and
the providers it refuses are in [visual-evidence.md](visual-evidence.md). A doorless surface with an address is
always photographable, so check `slopweaver catalog` before calling a picture unreachable.

**A `couldNotSee` blind spot is not an answer.** An answer carrying exactly that was rejected. A
composed `slack post --as bot` card is asked too, via `--no-picture-because` ([card form](../../slack/reference/the-card-form.md)).

## 4 — a Datadog citation opens on the window and the scope the claim was computed over

The first three rules ask whether a claim carries evidence. This one asks whether the evidence a reader
CLICKS shows them what the claim was computed from. It is a `warn` in the deterministic gate list, so it
fires before a reviewer exists and again at the door that sends. The rule, the per-view table and the
measurement behind it are in **[datadog-citations.md](datadog-citations.md)** — read it before you cite a
Datadog link, and never paste one out of the console address bar.

## 5 — a figure carries the command that measured it

A count, a proportion or a percentage asserted in prose owes an entry in `measurements` naming the command
that produces it again and when that command ran; the list renders below the fold. It is the fourth
show-your-work rule, DOCTRINE off a fleet finding. The criterion — which
digit runs are figures and which are masked as identifiers, dates and versions — is narrow and measured, and
the two refusals that bound the list have no hatch: **[measured-figures.md](measured-figures.md)**.

## 6 — a small-sample figure states its n in the same sentence

A figure computed over fewer than 50 observations is declared in `samples` as `{ "figure": "12.4s", "n": 6 }`,
and the sentence stating it must carry `n=6`. It sits inline rather than in the fold, because a reader who
never expands still sees it. No hatch: **[small-samples.md](small-samples.md)**.

## 7 — a measured graph finding attaches at least three screenshots

An answer that declares `measurements` AND links a Datadog console graph view (logs, traces, RUM, a metric, a
dashboard, a notebook, a monitor, a service page) carries three DISTINCT images or the form refuses, as a hunt reply of three leads and no media shows. Photograph
each lead's before/after panel, the error-rate or latency panel and the log query with `slopweaver datadog shot
explorer --url <link>` or `browser shot`, and record each with `browser image-record`. It is a floor, not
rule 3's question: `noPictureBecause` does not answer it, and rule 3 stays silent while it is owed. A held
release and an answer edit refuse the same shape; an edit cannot add media, so post a corrected answer naming
the old one in `supersedes`. One deliberate exception opens the journalled hatch `slopweaver hatch open
unshown-graphs --reason "<why>"`.
A bot [`finding`](../../automation/reference/finding-card.md) owes it too, counted by image digest in `--media`.

## Why the overrides are separate names

Waiving the figure rule must not also waive the citation gate, or the other way round: one shared variable
would have made waiving one leg waive the other too — the weaken-the-gate move, arrived at by accident. The
picture question has no hatch at all: its way through is `noPictureBecause`, which the ledger records. The
graph floor is the reverse — `noPictureBecause` cannot pass it, so its own journalled `unshown-graphs` hatch can.

## The citation budget

The cap is the answer's OWN item count, floored at twelve, so one more cited row buys one more citation:
**[citation-budget.md](citation-budget.md)**.
