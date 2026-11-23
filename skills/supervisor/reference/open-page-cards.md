# A card per open page — the six required fields, the fold, and the opt-in that keeps the page renderable

Bundled reference for the `supervisor` skill, linked from [fleet-briefing-shape.md](fleet-briefing-shape.md).
The ranked BAND is [react-now-groupings.md](react-now-groupings.md); this is the CARD each of its rows can
also become.

## What the owner asked for

On the react-now block, the owner wants each open page to have its own card rather than eighteen docs under one
card, because the what, the why, the options and the lean are useful to see. The owner also wants a ranked list
with the freshest page at the top.

**Two things.** The ranked list is `rankOpenArtifacts`: validity first, `landedIso` newest first inside each
band, so the top of the list is a page known to be fresh. The cards are this page: the six fields the owner
names, on every open page rather than only the authored cards.

## The command

```bash
slopweaver briefing render --form - --your-list run.json --open-prs \
  --open-artifacts open-pages.json --open-page-cards --out <html> < form.json
```

**A page whose validity mark is not `valid` gets NO CARD, and stays in the ranked index.** The owner's
ruling: a page the owner's own ruling has already settled, carrying its question anyway, is a card the owner has to read
to discover the owner has answered it. `partly-ruled` and `superseded` both mean a steer of the owner's covers what it asks,
so the row keeps its place in the index ([one-index.md](one-index.md) is deliberate about that) and simply
stops asking. This is the one exact, keyed relation available; [card-freshness](card-freshness.md) carries why
the broader "the owner has spoken since" rule is not.

**Every projected card carries the page's own landing instant**, as the `premise` field's `artifact` arm, with
`updatedIso` beside it when the page has moved, so no projected card reaches the owner without an age.

`--open-page-cards` needs `--open-artifacts`, because it builds its cards out of that same document, read
once. The cards land at the END of `meFacing`, behind whatever the form composed and behind the
pull-request cards — a card a supervisor wrote is a decision nobody else is tracking, and a projection that
runs again next tick must never push one below itself.

**ONE CARD PER PAGE — a page the block already cards gets no second one.** The owner met the same page asked
about twice, on a Vanta reconnect card and on a Google Calendar page, and does not know why the session asked
twice. MEASURED over `$SLOPWEAVER_HOME/supervisor-scratch`: of the 192 sweep directories
holding both a live `form.json` and a live `open-pages.json`, **14 composed react-now cards name a
`subject.url` the same sweep's document also carries**, across five pages in nine chairs'
scratch directories. That scan measures the SHAPE and not a live
duplicate: every address it returns is a `claude.ai` artifact url, which the local-copy rule refuses today,
so replaying those sweeps cards nothing. The owner's complaint is the evidence it reached the owner; the live
surface is the `file://` entries. The render drops the PROJECTED card and prints one line per page it
folded, so a chair can stop keeping the two in step by hand:

```
--open-page-cards folded 1 page(s) the react-now block already cards, so each reaches the owner once:
  Vanta reconnect: file:///…/pages/vanta-reconnect/index.html
```

Three things that are the rule rather than a note (`src/briefing/openPageFold.ts` carries all three):

- **The COMPOSED card wins, untouched.** Folding means the projection yields nothing, never that its prose is
  merged into the card the chair wrote — a merge would put sentences on the owner's card no composer authored.
- **A composer is never refused for carding one page twice.** One chair's form really carries four
  me-facing cards on one page url — four board rows, one page listing them — so the criterion can only ever
  drop a projected card.
- **The url is compared EXACTLY**, and the ranked band keeps the folded page's row. Both addresses are
  written by the same hand into the same home, so a normaliser over trailing slashes or fragments would fold
  `…#options-a` into `…#options-b`; if a near-miss reaches the owner the fix is the document. Only the CARD goes,
  never the index row ([one-index.md](one-index.md)).

`briefing card` does not check this — it writes the document and never reads the sweep's `form.json`. Write
the entry; the render folds it on every sweep.

Me-facing rather than team-facing because the grouping is AUDIENCE (`AGENTS.md` rule 10): each of these is a
page nobody but the owner is reading.

## An entry is WRITTEN by `briefing card`, never by a script or a hand edit

```bash
slopweaver briefing card --open-pages open-pages.json --row row.json [--replace] [--dry-run] [--json]
```

`row.json` is the entry below as one JSON object. The verb holds it to every gate the rendered page applies
to a projected card — the index schema's `ask` and `label` caps, the local-copy rule, every word and sentence
cap, the framing, jargon and voice rules — by projecting, rendering and checking it as the one me-facing card
of a one-card block, then appends it atomically. It refuses, writing nothing, on any defect (one line each, the
same lines `briefing check` would print a sweep later), on a url an entry already names (`--replace` swaps that
entry in place), on a page the owner's ruling already settled, on the fifty-first entry, and on a document the render
would refuse. Unknown keys pass through untouched. `--row -` reads stdin; `--dry-run` reports and writes nothing.

**An entry the owner's ruling overtook is DROPPED by the same verb**, never by hand:

```bash
slopweaver briefing card --open-pages open-pages.json --drop <url> [--settled-by <slug>] [--dry-run] [--json]
```

It removes the one entry naming `<url>` exactly, every other entry and key untouched, and only on evidence: the owner's
LAST lock-in ruling, in file order, under any key the index reads (approved, edited, rejected or dropped; a
`noted` or `deferred` settles nothing), else the board row `--settled-by` names, when it publishes that url (`artifact:` line or an
`artifact` event) and carries a settlement, a terminal status or a dated ruling. No evidence, a url no entry or
two entries name, or a document the render would refuse: refused, writing nothing, one reason per line. A ledger
that exists and will not read, or a line of it that will not decode and may name the page, refuses outright,
`--settled-by` included: the owner's last word is unknown. MEASURED
by dry run over one chair's `open-pages.json`: 35 of its 38 entries already had a deciding ruling.

MEASURED over one week: 122 `cards<n>-<m>.py` copies in one chair's scratch re-asserted caps
`src/briefing/caps.ts` holds, beside 2,403 `jq` and heredoc edits of `open-pages.json` and `form.json`. An entry
a script or a hand edit wrote is the defect, whatever it says.

## The six fields — four on the entry, two READ FROM THE PAGE — and the render REFUSES without them

Each `open-pages.json` entry carries `label`, `url`, `ask`, `landedIso` and:

| Key        | What it is                                                                             |
| ---------- | -------------------------------------------------------------------------------------- |
| `question` | the card's own question, one sentence ending in `?` — **from the page**                |
| `what`     | two to four sentences of background                                                    |
| `whyYou`   | one sentence on why only the owner can settle it                                       |
| `options`  | one to four `{ "letter": "A", "text": "…" }`, each routing the owner to the supervisor |
| `lean`     | which option, and why — **from the page**                                              |
| `ifSilent` | what happens if the owner says nothing                                                 |

**For a local page, `question` and `lean` are NOT on the entry**: the page marks them `data-card="question"`
and `data-card="lean"`, the card reads them from its frozen bytes, and a typed copy is refused. The cutoff, the
typed notice and the residue are [page-card-marks.md](page-card-marks.md).

The `label` and `url` become the card's linked subject line, so its title is clickable and the voice pass
never reads it. Every cap the authored cards carry applies — the projection builds a
`BriefingCard` and the schema then judges it like any other.

**A seventh key, `detail`, is OPTIONAL and is the card's collapsed fold** — `{ "summary": "<what a reader
clicks>", "blocks": [ … ] }`, the same shape an authored card's `detail` takes, and never a string. A `detail`
that is not a fold is REFUSED by name rather than coerced: a card once
flattened a numbered list into one string, and rendering that as a paragraph would have looked like a fix.

**A me-facing card names above the fold every command the owner has to type.** The
setup-token card put both its commands in `detail` while its `what` pointed at them, so the owner read a card citing
a fold that was not there, searched the linked page for `claude setup-token` and found 0 of 1; the session
should have written the command on the card. Both the form and `briefing check` refuse a
me-facing card whose fold holds a command its above-the-fold cells never name, and the refusal names the
command. The criterion is a `code` run of two or more tokens opening on a known command head — structural
first, because a purely lexical rule matched the prose phrases "slopweaver and", "claude session" and
"git watch" on real documents and no real command at all
(`src/briefing/commandAboveFold.ts` carries the measurement). If
surfacing a command runs `what` over its cap, fold the OTHER prose: never the command.

**The `url` is a PAGE, never a markdown document.** A finding card
whose `url` was the finding's own `handovers/<slug>.md` puts a markdown file in front of the owner, which is hard
to react to, and with extra details the answer might not fall into A, B or C. A finding seat publishes its page with `slopweaver page publish`
before anything cards it, and THAT address is the entry's `url`; a finding with no page yet is a board row,
not an entry here. `briefing render` refuses every entry whose `url` path ends in `.md` — any scheme, any
directory — naming each by index and url in one pass, and takes the render red until they are re-pointed or
dropped. MEASURED: one chair's live `open-pages.json` carried five, at entries 14, 17, 25, 26
and 29. What the page carries — what was measured, why it matters, the candidate causes, the options with their
cost — is [finding-page.md](../../handover/reference/finding-page.md).

**The `url` is the page's LOCAL COPY, and the render refuses anything else.** Every page the owner reacts to keeps its
rendered html under `$SLOPWEAVER_HOME/pages/<slug>/index.html`, written by `slopweaver page publish`: never
on claude.ai, never in a temp directory or a scratchpad (the owner's ask
`every-published-page-keeps-its-rendered-html-under`). A card whose page lives anywhere else is a page the owner
may not be able to open, that no session can republish and that `briefing corrections` cannot diff.
`--open-page-cards` refuses a card whose `url` is a claude.ai address or a `file:` address outside this
home's `pages/` directory, and names every offender in one pass. A GitHub or Slack subject is not a page, and
a page the owner's ruling already settled gets no card, so neither is refused (`src/briefing/localCopySubject.ts`).
MEASURED: one chair's `open-pages.json` carried 8 claude.ai pages out of 38, none with a copy on disk.

**If an address stops resolving, republish from the local copy. Never re-author the page from memory.**
Edit the fragment and run `page publish <slug>` again. If the fragment is gone, `unwrapPageFragment`
(`src/pages/shell.ts`) recovers it from `index.html` in either shell, and every earlier version stays frozen
in the store under `<slug>`. The console serves an older page in the current shell, which changes its head
only; marks and corrections always read the frozen bytes. A page with no local copy anywhere is dropped from the document until a session
publishes one.

**There is no derivation beyond the two marks, and that is the design rather than a gap.** A `what` synthesised from the page's
own `ask` would be the same sentence twice, and twenty-five cards of filler is a worse wall than the one fold
they replace. A page missing any field is refused by name, every unwritten page at once rather than the first.

## The flag is opt-in, so an unauthored document never takes the owner's page dark

The refusal is absolute **once the flag is on**; a run without it indexes the pages and cards none of them.
The owner's page going dark mid-reaction is worse than the cards arriving a sweep later. Same form, both paths:

```bash
briefing render … --open-artifacts open-pages.json
  → 7 react-now card(s), 27 open page(s) indexed, the page passes `briefing check`

briefing render … --open-artifacts open-pages.json --open-page-cards   # against an unauthored document
  → refused, one line per page naming question, what, whyYou, lean, ifSilent
```

Fill the file, then add the flag, in the same sweep.

## What this costs the seat that fills the file

A question, a `what` of two to four sentences, a `why you`, up to four one-word-answer options, a `lean` and
an `if silent`, per page, per sweep. That is real prose, and it is the reason the projection refuses instead
of guessing. A sweep that cannot write them for a page yet should leave that page out of the document rather
than write filler into it — it still appears in the owner's list through the other registers, and a card the owner skims
past teaches them to skim the block.
