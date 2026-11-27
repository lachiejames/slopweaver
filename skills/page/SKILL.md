---
name: page
description: Publish the ONE page a session ends in into the store with its own address, named $SLOPWEAVER_HOME/pages/<slug>/index.html — the document shell supplied, the exact bytes frozen so a later correction has something to diff, and the address printed. Use whenever a run's deliverable is a page for the owner to react to, in place of the Artifact tool, and when a page needs republishing after the owner's steer. Phrases like "publish the page", "give the owner a page to react to", "end this in one page", "republish that page".
argument-hint: "review-prepare <slug> --page <html> --inputs <file,...> | publish <slug> --page <html> --review <id,...> [--assets-from <dir>] | find [<words>...] | tag <slug> --meeting <event-id>"
---

**A Claude artifact is not an option here.** The owner's ruling: every page the owner reacts to is a local
file. The `Artifact` tool is refused by the owner's user-level settings and again by
the `admit` check in `src/admit/artifactTool.ts`, which names this verb in the refusal. There is no page-publishing surface but
this one.

## Review it, then publish it

**Every page that reaches the owner carries at least one Codex review pass** (the owner's word: an inaccurate or
incomplete briefing makes the owner steer off bad information). `publish` refuses a page that cites none.

```bash
slopweaver page review-prepare <slug> --page <fragment>.html --inputs <owner-words>.md,<the run's doc>.md
# run the `codex review` it prints (or, Codex capped, the Claude fallback pair it prints)
slopweaver page publish <slug> --page <fragment>.html --review <artifact-or-receipt-id>[,…]
```

`review-prepare` commits a README at a base and the inputs with the page at a head, so the diff every reviewer
reads carries what the owner asked beside the page that answers it. `publish` proves each cited id read THIS page's exact bytes, and folds what it attacked,
what it found and what changed since into the page. A BROKEN verdict or a page edited after its review publishes
only with `--review-changed "<what you did>"`, and the fold tells the owner the edits were not re-reviewed. The hatch,
`SLOPWEAVER_ALLOW_UNREVIEWED_PAGE=1`, publishes a page whose fold says it was NOT reviewed. Properties to attack,
the fallback, the record: **[reference/review-record.md](reference/review-record.md)**.

`publish` prints the address to give the owner, its size and freeze, the `page:<slug>` identity a ruling is recorded
under, and where the review record is; `--json` gives the same facts as one object.

**Inside a run, the page becomes the run's artifact** — the session holding a run gets an `artifact` event and a
third line saying so — and **a published page is not a delivered one.** `handover settle` and `finish` refuse until
the page reached the owner's Queue: end on `handover ask <slug> --question "<the decision> — page:<slug>"` with the whole
shape ([running a run](../handover/reference/running-a-run.md)). A publish writes only [the store](../../docs/store/published-pages.md),
nothing on disk; one the store refuses exits non-zero with no address. Re-run the same publish.

**It refuses, and writes nothing,** when an `<img>` cannot load from the console (a `file:` or absolute path, or
a relative file `--assets-from` lacks) or the prose carries a machine timestamp like `<HH:MM>Z`
(`src/pages/lint.ts`, hatch `SLOPWEAVER_ALLOW_PAGE_LINT`).

**Every identifier the owner reads is a link** (the owner's ruling). Before the lint, the verb LINKS each bare one it can
resolve — a Vanta control or test id off the atlas, a Linear key, `#N` against a repo the page's own links name —
and prints `linked <id> → <url>` per wrap. A bare `#N` under 100 is a rank and is left alone; an id that is both a
Linear key and a control is linked by hand. It then refuses what is left: an identifier it could not resolve
(`UNLINKED_IDENTIFIER`), an `INC-N` with no link, a bare URL (`UNLINKED_URL`), and a session, call, talk, turn or
run id in prose or link text (`RAW_MACHINE_ID` — name it by what it was doing; the id goes in an `href` or a
`title=` hover at most). Text in `<code>`, `<pre>`, `<kbd>` and attributes is never read
(`src/pages/identifiers.ts`). A queue card refuses the same machine ids in its drawn prose
(`site/lib/machineIdForm.ts`).

Record the `file://` address; a console card links the same page as `/api/page/<slug>/index.html`, because
Chrome will not follow a `file://` link from the console ([queue doc](../../docs/console/queue-and-triage.md)).
The desktop viewer's **Reveal in Finder** copies the page out of the store as one file (`page export`) and selects it
to drag into Slack ([reveal in Finder](../../desktop/docs/reveal-in-finder.md)); never send the owner to a path.

## A page that preps a meeting is TAGGED to it

A prep page nobody puts in front of the owner is a page they go into the meeting without. That is what
happened once: the page for the owner's one-on-one was cut the day before, the owner asked the voice for it
minutes before the meeting, and went in without it. So once the page is published, tie it to the meeting:

```bash
slopweaver page tag <slug> --meeting <event-id> [--calendar <id>]
```

The event id is the INSTANCE id `slopweaver calendar list` prints for that day. A recurring series' id is
refused, and so is an all-day or cancelled event. The verb reads the event live, records its start in
`$SLOPWEAVER_HOME/page-meetings.jsonl`, and prints the page's address. In the hour before the meeting, the
`meeting-prep-due` monitor floats a note whose Open button is the page, and the note goes when the meeting
starts or when the owner closes it ([meeting-prep-due](../monitor/reference/meeting-prep-due.md)).

**A meeting the owner will talk in is put on the board for you.** `calendar prep-due`, run hourly by the
`meeting-prep-hourly` row, registers one `meeting-brief-<instance id>` dispatch row per qualifying meeting
([calendar](../calendar/SKILL.md) § Meeting prep). A seat on that row publishes, tags, and settles only once the
tag succeeded: a row settled with no tag is a meeting the owner walks into unbriefed.

Four limits worth knowing:

- **The start is the one the tag read.** A meeting moved after tagging fires at the old time, so re-run
  `page tag` to refresh it.
- **The hour starts at the first supervisor tick inside it.**
- **An untagged page is never found.**
- **Two meetings inside one hour show one at a time, soonest first.**

## Finding a page from what the owner said

```bash
slopweaver page find twenty potential icons [--limit <n>] [--json]
```

The owner's published pages with their titles, read from the store, ranked by how many of the owner's words the slug or title
carries, then newest first; with no words, the newest. A store it cannot read fails the verb, never an empty list. A described
page is never in a listing: the voice once listed 429 untitled directories, never reached "the twenty icons page", and
asked the owner for its link. The voice runs this
through its `verb` tool, then opens the slug with `browser present --page <slug>`, a new tab in front in the
desktop app. `page publish` prints the same deep link (`slopweaver://open?path=…`) on its second line. Only slug and title are
searched, never the body.

## Author a FRAGMENT, never a document

The file you pass is a `<title>`, optionally a `<style>`, and the content — **no** `<!doctype>`, `<html>`,
`<head>` or `<body>`. The verb supplies those, in `src/pages/shell.ts`.

## The shell carries the LOOK; you carry the words

The owner's ruling, on a page opened from the Queue that read like an internal uni webpage from the 80s — full
width, no margin, no hierarchy: the owner expects a page to read like a Claude artifact, a designed, landing-page
scroll. So a fragment with **no stylesheet of its own** gets the HOUSE design — a centred column at the owner's ruled
measure (88% of the window, at most 140ch), a serif hero title with the next paragraph as its lede, every `h2`
a section, and tables, figures, quotes and folds as cards. Write semantic HTML and reach for the house classes;
**[reference/house-style.md](reference/house-style.md)** lists them.

- **Bring a `<style>` and the house design steps aside entirely.** The page gets only the plain platform reset,
  so a page you design yourself renders exactly as you wrote it. Design it as an artifact would be.
- **An image is read from `--assets-from <dir>`.** Link it relatively (`charts/a.png`) and pass the directory it
  sits under; the store keeps it beside the page, and only what the page loads. The console serves only the page's
  own files, so `publish` REFUSES a `file:` address, an absolute path or a `../` climb before writing anything,
  naming each one. The hatch,
  `SLOPWEAVER_ALLOW_PAGE_EXTERNAL_LOCAL_ASSET=1`, is for archival HTML only.
- **A page published under an older shell** opens from the Queue in the current shell too: the console re-wraps
  it as it serves it, and the file and its freeze stay byte for byte as they were.

Two consequences worth holding:

- **Your fragment reaches the store byte for byte**, its links added and the review fold appended after it. Nothing
  trims, re-indents or re-encodes it; `briefing corrections` ignores the fold.
- **Never feed the verb its own output.** That would wrap a document in a second shell. Republishing means
  editing the FRAGMENT and publishing it again — which is why keeping the fragment beside the page matters.

## A page the owner answers MARKS its own question and lean

When a page asks the owner something, mark the one sentence that is its question with `data-card="question"` and the
one that is its lean with `data-card="lean"` — exactly one element each, card-sized, e.g.
`<p data-card="lean">A, because …</p>`. A react-now card for the page reads those two from the page's frozen
bytes and refuses a copy typed onto its `open-pages.json` entry: a card once carried lean B where the page's
lean was A, and a lock-in was stamped with the card's (`src/briefing/pageCardMarks.ts`). A page landed with no
marks gets no card
([open-page-cards.md](../supervisor/reference/open-page-cards.md)). Mark plain visible text, and keep a marked page
static: no script in any spelling, meta refresh or shadow root ([what is refused](../supervisor/reference/page-card-marks.md)).

## The slug is the identity, in three places at once

Pick a short readable name — letters, digits, dot, dash, underscore, first character alphanumeric. It becomes
the page's address, its freeze-store key, and the `page:<slug>` a lock-in row names. Anything else is
refused rather than rewritten, because a quietly rewritten slug puts a page's history where its next publish
cannot find it.

Republishing the same slug replaces the page's document and keeps the version the owner already read. That pairing is the
whole point: `slopweaver briefing corrections --artifact <the file URL> --page <the new page>` marks a
republished page WHERE it changed, computed from the diff rather than from an author's memory.

**The store's copy is the page, so publish it.** Never render a page the owner reads into tmp or a scratchpad
and link that. Keep the fragment, and republish it rather than rebuilding the page. The supervisor's page cards
refuse any other address
([open-page-cards.md](../supervisor/reference/open-page-cards.md)).

## What the address is good for, and what it is not

A local address is a first-class subject across this tree — the ranked open-page index keys on it, a lock-in
rules on it, the owner's list links it, the renderer linkifies it in prose. The two lookups that would fail silently on
one, and how each handles it, are in `reference/local-addresses.md`.

What it is **not** is reachable from the owner's phone, or from any machine but this one. If an ask genuinely
needs the owner to read it elsewhere, say so in the card rather than publishing somewhere else.

**So a page is a deliverable for THE OWNER, in a DM — never for a room.** A bot answer landing in a channel may not
name a path under this tree at all: `src/admit/documentDeliverableGate.ts` refuses one, because everyone else
in the thread gets an address that resolves to nothing. Attach the file instead, through the answer form's
`documents` lane, markdown first and the rendered html second. The turn that handed a team channel four
`~/.slopweaver/pages/iso-*/` paths, and the owner's reply that they were written locally, is in [links-citations-and-shots.md](../loop-bot/reference/links-citations-and-shots.md) § 0b.

## Detail

- **A fleet FINDING is one of this verb's uses, not an option.** A finding card links the page its seat published here,
  never its `handovers/<slug>.md` — the render, the form and `briefing check` refuse a markdown url.
  What the page carries: [finding-page.md](../handover/reference/finding-page.md).
- **[reference/local-addresses.md](reference/local-addresses.md)** — what a local address does and does not
  reach, the two lookups a local address would break, and how a ruling about a page is recorded.

## Authoring the page before you publish it

Half of one day's pages carried a layout defect their careful authors could not see, and the commonest
content defects — a stale total, a count of a list, a tidied quote — read right to the person who wrote them.
Each is found by a mechanical check, never by looking again:

- **[reference/render-ladder.md](reference/render-ladder.md)** — measuring the boxes: the width ladder at rest
  and folds-open, unclipped overflow, the squeeze detector, proving a probe touched what it claims, and
  isolating a defect with no render at all.
- **[reference/narrow-width.md](reference/narrow-width.md)** — the CSS causes the ladder finds and their fixes,
  the scroller's viewport-and-floor pair, and measuring a token's longest unbreakable run.
- **[reference/page-consistency.md](reference/page-consistency.md)** — totals summed by machine, no number
  counting another part of the page, citations dereferenced, and the shelf life of a claim a command can
  falsify.
- **[reference/quote-checking.md](reference/quote-checking.md)** — checking every quote against its source
  before it ships.
- **[reference/telemetry-briefing.md](reference/telemetry-briefing.md)** — the shape for a page about a
  metric over time: charts first on one scale, every stat in a table with its formula on hover, every claim
  linked to the view that shows it, humane times.
