# A page card's question and lean are read from the page

Child of [open-page-cards.md](open-page-cards.md) § The six fields. The authoring half is the
[page](../../page/SKILL.md) skill.

## Why

A `question` and `lean` typed onto an `open-pages.json` entry from a session's memory of the page drift from
it. MEASURED, twice: one card asked four questions its page
does not ask, and another card carried lean B where the page's lean was A, and a lock-in was stamped B. Review cannot catch that at the rate cards are written, so the
fix is at construction: the card has no typed copy to drift.

## How

The page marks one element `data-card="question"` and one `data-card="lean"`, each card-sized. For an entry
whose `url` is a local page, the projection reads its newest frozen bytes from the published-page store
(prefetched before it runs, a store failure refusing the render) — the version a lock-in rules against, not `index.html` — and takes
the two marked elements' text (`src/briefing/pageCardMarks.ts`). Then:

- an entry that ALSO types `question` or `lean` is refused, naming the key to delete;
- a mark with an unknown value, marked twice, holding no words, nested in another mark, or one of the pair
  missing is refused. So is a mark the page may never show: on or under a tag outside an ALLOWLIST of tags
  drawn as words (a `<dialog>`, a `<title>`, a `<template>` all fail it), `hidden` or `popover`, past a closed
  `<details>` summary or in a named `<details>` group, struck, or under an inline style that hides it. Inside a
  mark only drawn text is allowed, with no inline style, `dir`, bidirectional control character or `<img>`
  carrying alt text; a struck (withdrawn) run in it is dropped;
- a marked page carrying script in any spelling (a `<script>`, an `on…` handler, a `javascript:` or `vbscript:`
  URL, a non-image `data:` URL in a `src`/`href`-style attribute, a `srcdoc`), a `<meta http-equiv="refresh">` or a declarative shadow
  root is refused, since each can change what a reader sees after the bytes are read;
- a page's address must be exactly `pages/<slug>/index.html`, because the freeze store is keyed by slug alone;
- a GitHub or Slack subject has no page, so it keeps both typed fields.

**A composed card may not contradict the page either.** A card the chair composes onto the form types its own
question and lean, so `briefing render` reads the frozen marks of every page a composed card names and refuses
the card if either differs (`src/briefing/composedCardDrift.ts`) — whether or not any `--open-artifacts`
document lists the page, and with `--open-page-cards` on or off. Make the card say what the page marks, or drop
it and card the page with an entry. A page whose marks do not read refuses the card with their problems, as it
refuses an entry, and so does a page whose freeze is damaged (an unreadable pointer, a pointer missing beside frozen versions, a vanished frozen file). A
page never frozen, or with no marks, gives nothing to hold it to, so a page carded once per row it lists (four
composed cards on one page) asks no single question and marks none.

## Stamping the owner's ruling: the owner answered the CARD

The marks keep a card from drifting off its page; they do not decide what the owner's words ruled. The owner reacts to the
card, so when the owner replies that the session's lean stands, that rules the card's lean A and says nothing about
questions only the page asked — and a session reached for the page's one printed lean as what the owner must
have meant, the same error one layer down. **A lean the owner did not see is not a lean the owner went with.**

- Stamp only what the card put in front of the owner. A question on the page and not on the card stays open, and
  the page says so.
- A relay's characterisation of the questions is not the questions: read the rendered card the owner saw.
- Never `handover answer` a question the owner was not shown — that journals an answer the owner did not give.
- Keep the owner's words and your gloss apart in what you stamp; an inference of the chair's is never quoted as the owner's.

## The cutoff, and why there is one

An entry that landed before marks existed types both fields over an unmarked page, and refusing every one at
once would take the owner's briefing dark. `PAGE_MARKS_REQUIRED_FROM_ISO` is a fixed cutoff, compared with the entry's
`landedIso`:

- **on or after it**, a page with no marks, or with no frozen bytes, is refused;
- **before it**, the typed pair stands, and `briefing render` and `briefing card` print a line naming the page
  on every run, so the debt is visible rather than silent with its reason — unmarked, or bytes that could not be read (`briefing card --json` reports `typed` and
  `typedBecause`).

Retire one by marking its page, republishing it with `slopweaver page publish`, and dropping both keys with
`briefing card --replace`.

## What this does not catch

The page's author is trusted: the failure this closes is a card typed from a session's MEMORY of a page. The
concealment refusals keep an honest page from hiding its own mark by accident; they are not a sanitiser against
a page built to mislead, and four review passes each found another way to build one.

- **The options stay typed**, so a page's lean naming a letter the entry's options lack is not caught here, nor
  a lean marked on an `<li>` whose drawn list marker is a letter the card does not read.
- **`landedIso` is typed too**, so a composer can back-date an entry past the cutoff. That is visible in the
  typed notice, not refused.
- **A stylesheet rule hiding a mark is not seen**, nor an ancestor's inline style hiding it some way other than
  `display`, `visibility`, `content-visibility`, `opacity` or `font-size` (`declarationHides` in `src/briefing/pageCardMarks.ts`), nor a SIBLING's
  inline style that reaches it (a `<col style="visibility:collapse">` over the mark's table column).
- **A composed card naming a COPY outside this home's `pages/` directory** (a copy under a temp directory, a
  deeper `pages/a/pages/b` path) is not held to any page's marks: the freeze store is keyed by slug, so reading
  one would hold the card to a page it does not link. An address is held to BOTH the page it spells and every
  page whose file it opens, matched by device and inode (`pagesOpenedOnDisk`,
  `src/cli/commands/briefing/publishedPageReader.ts`): a doubled slash, other letter case, a symlink, a macOS
  firmlink, a hard link, a `file://host/` prefix. An address naming no file is matched by the page directory it
  names; one whose page directory is gone as well is held only by its spelling.
- **A refused render's `<out>.refused.html` can still show the drifted card.** It is the diagnostic written
  beside `--out` so the chair can read what was refused (`src/cli/commands/briefing/refusedPage.ts`), never
  published, and `--out` itself is not written.
