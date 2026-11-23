# The issue form — kinds, blocks, and what the schema refuses

The two artifact kinds, the block vocabulary, and every structural refusal with the document breakage behind
it. The rule — never hand-write a Linear description; fill the form and let the renderer emit the bytes — is
in [SKILL.md](../SKILL.md).

Never hand-write a Linear description. Fill the typed form and let the renderer produce the markdown — that
is the whole design, and it is what makes the output byte-stable and the malformed cases unrepresentable.

Two kinds, discriminated on `kind`:

**`structured`** — the default, and what you should reach for. The sections ARE fields, so you cannot emit a
heading and cannot get the order wrong.

```jsonc
{
  // teamId is the team's UUID, never its key (refused on dry run and live); `linear states --team <key>` prints it
  "fields": { "teamId": "<uuid>", "title": "One line", "priority": 2, "estimate": 3 },
  "artifact": {
    "kind": "structured",
    "problem": [{ "kind": "para", "text": "What is wrong. Opens with prose, never an image." }],
    "proofOfProblem": [{ "kind": "para", "text": "Optional. Evidence it is REAL, not evidence of the fix." }],
    "solution": [{ "kind": "para", "text": "What to do." }],
    "acceptance": ["A checkbox line", "Another"],
    "aiPrompt": [{ "kind": "para", "text": "**Goal.** Unbounded detail lives here." }],
  },
}
```

**`freeform`** — the escape hatch, for a ticket that genuinely does not fit. One ordered `body` where you
control headings. It still requires `aiPrompt`, and it may NOT re-create `Problem` / `Solution` /
`Acceptance criteria` — impersonating the structured shape while skipping its guarantees is worse than
either option honestly.

## Blocks, and the one that matters

A section is an ordered array of blocks: `para`, `bullets`, `checklist`, `media`, `code`. Order is
preserved, so **media is positional** — an image belongs where you put it. This is the reason Linear does not
share Slack's form, where media is a flat attachment bag.

A `bullets` item may carry `nested` blocks, so a screenshot belongs to the step it illustrates:

```jsonc
{
  "kind": "bullets",
  "items": [
    { "text": "Open the import dialog." },
    {
      "text": "Select the CSV.",
      "nested": [{ "kind": "media", "alt": "the failure", "mime": "image/png", "url": "https://…" }],
    },
  ],
}
```

`media.mime` is required and decides the rendering: an image embeds, anything else links, because an image
embed around a PDF renders broken. PDFs, CSVs and markdown files are all fine.

## Folding a long proposal's detail: `details`

Problem and Solution are capped at 50 words and `aiPrompt` is the agent brief, so a long human-facing proposal
folds its supporting detail into `details` — optional on BOTH kinds, one Linear `+++` collapsible per entry,
rendered in order after Acceptance criteria (or the freeform `body`) and before the AI prompt:

```jsonc
"details": [
  { "title": "Options weighed", "blocks": [{ "kind": "para", "text": "Why this route over the others." }] },
]
```

It is a FIELD, never a block, because Linear's collapsibles do not nest: a fold inside `aiPrompt`, a list item
or another fold would close the outer one early. `blocks` takes the section vocabulary (no heading). Its words
never count toward the 50-word caps. A title is one line, may not end in `+++` (the one-line form renders as
text) and may not be `Prompt for AI agents`, which tooling reads as the agent brief. A `#<n>` or `@{key}` in a
title is resolved like any prose; the corpus holds link-titled folds Linear stored, but whether it renders a
link or a mention on the title line as clickable is unwitnessed.

## What the form refuses, and why it is not a content rule

Structure only, in the SCHEMA. Slopweaver supplies the shape; you supply the words.

**Above the fold is the exception, and it is a separate gate at the door.** `## Problem` (with
`proofOfProblem`) and `## Solution`, and a comment's `summary`, go through the operator's exact voice rules
plus the packing rules — no colon-introduced list, no semicolon-joined clauses, one parenthetical aside, no
sentence over 30 words. It REFUSES rather than trims, reports on `--dry-run`, and
`slopweaver hatch open voice-rules --reason "<why>"` is the one deliberate exception. `aiPrompt` and a comment's `detail` are
never scanned, so a body quoting an error message with a dash is still correct input below the fold.

Refused because each one silently breaks the document:

- **A `+++` line in prose.** It is Linear's collapsible delimiter, so it closes the AI-prompt block early and
  reattaches the rest to the previous section. Inside a `code` block it is ALLOWED — the fence is sized longer than any backtick run in the
  content, so a unified diff's `+++ b/path` headers are inert.
- **A `#` line** in a structured field, which escapes its section.
- **A code fence in a `para`**, which opens a block nothing closes and swallows every later section
  including the collapsible.
- **A newline in a list item, acceptance item, heading or title** — each renders as one line.
- **Raw HTML** in any markdown field — a `<!--` comment, a `<div>`, a `<b>x</b>` — because an unclosed one
  swallows every `+++` after it, the AI-prompt fold included. A `<` in a code span (`` `Array<string>` ``), a
  `code` block, a comparison (`a < b`) and an autolink stay allowed; an unquoted `Array<string>` is HTML to
  the parser and is refused, so code-quote it. A plain-text field (a title, a project's `description`) is
  not markdown and is not checked.

These hold on every Linear form that renders markdown: the issue body, a comment, a project update and an
initiative update (summary and `detail` alike — the folded `detail` gets every block check an issue section
does), and a milestone's `description`. A comment or update summary also refuses a code fence, which would
swallow the detail fold rendered under it. A media alt and an evidence label are NOT refused raw HTML: each
has its brackets and angle brackets escaped as it renders, so `Array<string>` in a caption comes out as
written and an escaped `\<tag>` cannot come out raw. A mention's roster label, inserted after the form is
checked, has its brackets escaped and its backticks, angle brackets and quotes folded to a space, since it can
land inside a code span or a tag the author left open, where a backslash escapes nothing (and a roster id that
is not Linear's UUID resolves nothing).

"A line" here means any line ending Linear honours: CR, LF, vertical tab, form feed, NEL, U+2028 and U+2029.
So a `+++` after a vertical tab is a `+++` line.

**Never write a bare PR number or ticket key — always a link.** `#<n>` and `ABC-<n>` typed as plain text are
resolved into a real markdown link automatically wherever the repo (or the connected Linear workspace, for a
key) is unambiguous; a reference the door cannot resolve is REFUSED rather than sent bare, naming each one.
A workspace slug that is not a Linear URL key (letters, digits, `-`, `_`) links nothing, and neither does a
repo (the checkout's `origin`, say) that is not a GitHub owner/repo; each refusal names the malformed value.
Any resolved URL carrying whitespace or a link-breaking character (`(`, `)`, `<`, `>`, `[`, `]`, `\`, a
backtick, `|`, `"`) links nothing either.
`slopweaver hatch open bare-refs --reason "<why>"` is the journalled break-glass. Applies to an issue's body, a comment and a
project-update alike — and to `linear project create|update` and `linear milestone create` too, with one
difference: a **project's own `description` is plain text, not markdown** (see `## A project UPDATE is not a
project update` below), so a resolved reference there becomes its bare URL inline rather than `[label](url)`
— there is no link syntax for a plain field to render. A milestone's `description` IS genuine markdown, so it
gets the same `[label](url)` splice an issue body does.

## The comment form

The same block vocabulary, arranged for one message rather than for a ticket. `summary` is capped at 50 words
and is the whole comment as far as anyone scrolling past is concerned; `evidence` is REQUIRED and non-empty,
because a comment reports a FINDING and a finding with no link is a claim with no provenance.

```jsonc
{
  "fields": { "issueId": "<uuid>" },
  "artifact": {
    "summary": "One line. This IS the comment as far as anyone scrolling past is concerned.",
    "detail": [{ "kind": "para", "text": "Optional. Same block vocabulary as an issue body." }],
    "evidence": [{ "label": "the failing run", "url": "https://…" }],
  },
}
```

### On a document, inline

A comment on a Linear DOCUMENT (an RFC, a spec) names it instead of an issue, and may quote the passage it
answers so Linear anchors it there:

```jsonc
{
  "fields": { "documentId": "<uuid or slug id>", "quotedText": "Lean: no, as a follow-up." },
  "artifact": { "summary": "i'd push to do this first, or at least alongside.", "evidence": [] },
}
```

The verb reads the document first — for the `documentContentId` Linear attaches the comment to, and to check
`quotedText` is on ONE line of one block of its current content — a paragraph, heading, list item, table cell
or code-block line — as the markdown RENDERS (emphasis drawn away, a link read as its label, a code span
verbatim; a link to Linear itself — an issue or project mention, an upload — is drawn as a chip and never matches, nor does a collapsible's `+++ ### Title` heading, struck-through code, or a block marker inside a table cell;
a `*`, `_`, `~`, `|`, backtick or backslash the markdown did not escape is a break, and so is a character reference such as `&amp;`, even as code in a table cell, and so is the space markdown strips from each edge of `` ` code ` ``, since Linear may draw it as
formatting; a quote never starts or ends with whitespace;
image alt text, link definitions, autolinked URLs and a mermaid block's source (any `mermaid…` language) never match, and no
quote spans a line ending, a code span's included, or starts or ends mid-character; a quote must hold something
visible). A document holding raw HTML anywhere, a comment included, or a link reference definition
(`[a]: …`, whose references Linear's editor may not resolve) or an indented code block (Linear fences its own),
anchors NO quote, nor does one with a fenced code block that is unclosed, empty, holds a line of backticks, or
touches a line of text, since Linear never lengthens a fence around code that holds one — what HTML
hides has no boundary the verb can find — so comment on it top-level. Quote what the page
SHOWS: the quote is compared exactly, whitespace included, and sent byte for byte as checked. A
quote that is not there is REFUSED before the door, exit 2, because an inline comment anchored to nothing is
pinned nowhere; `--dry-run` makes the same read and prints the verdict on its `anchor:` line. Omit
`quotedText` for a top-level comment on the document. `evidence` may be EMPTY here, and then the body is the
summary alone with no fold: the quoted passage is the provenance, and a reply to an RFC in a person's voice
does not grow an evidence list.

A REPLY in an existing thread names the thread's root comment as `parentId` and carries no `quotedText` — it
inherits the thread's anchor, and a form with both is refused:

```jsonc
{
  "fields": { "documentId": "<uuid or slug id>", "parentId": "<the thread's root comment id>" },
  "artifact": { "summary": "yeah security is fine by me.", "evidence": [] },
}
```

Linear threads one level deep, so the verb pages the document's comments for `parentId` before the door:
absent is `PARENT_NOT_FOUND`, a reply named as the parent is `PARENT_IS_REPLY` (naming the root to use), both
exit 2. A comments read it cannot trust whole — a node not stating its parent, an id listed twice — is
`DOCUMENT_UNREADABLE`, exit 1, never absence. `--dry-run` makes the same read and prints `reply to:` and the
thread's opening line on `anchor:`; with no token it REFUSES a reply rather than preview one unchecked. To FIND a root, `linear read
<document-url> --include comments` lists them as `parentId: null`; that read carries Linear's payload unvetted,
so the reply's own check, never the listing, is what decides a parent is a root.

A project or initiative status update is the same three fields with `health` alongside the destination, and
its `evidence` is OPTIONAL — see [project-updates.md](project-updates.md) for why that is a different call
rather than an inconsistency.
