---
name: notion
description: Read one current Notion page or database through the official SDK, with explicit traversal bounds. Use when the user supplies a Notion page or database URL or id and needs its current provider state rather than historical corpus context.
argument-hint: read <id|url> [--json] | page <create|update|move|archive> | verify <id|url> [--login]
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" notion $ARGUMENTS` and report the result.

## One object, not a crawl

`notion read <id-or-url> --json` reads one page object plus its first 25 top-level blocks. It can extract one
unambiguous Notion URL or object id from a natural-language routing question. `--limit` can deliberately
raise the top-level block cap to at most 100 — Notion's own maximum page size, not ours. It states when
another top-level page exists. That residue is part of the answer; do not describe the result as a complete
page when it is present.

**Every block nested under the slice is expanded** — toggles, headings, columns, callouts, quotes, tables,
synced blocks — through the children endpoint, paged, breadth-first, so you see what the owner sees in Notion.
`data.blocks.results` stays Notion's raw top-level slice; `data.blockTree` is the same slice with each node's
`children`, and `data.nested` says whether that expansion is `complete`. A synced duplicate is read through
its original's id, because listing the duplicate's own id answers an empty list without an error (measured).
Child pages and databases are NAMED in `data.nested.linkedObjects` with their url, never read
inline — each is its own object. Expansion is bounded by `--nested-calls` (default 400, at most 2000) and a
300s clock checked before each call, breadth first by page so every sibling's first page is read before any
block's second; a block it could not expand is named in `data.nested.unexpanded` with why, and `complete: false`
means the page is NOT whole — raise the ceiling or read a smaller slice with `--limit` and `--after`.

**`--pdf` carries what the page's files SAY, not where they are.** A file reaches a Notion page two typed
ways and this reads both: as an `audio`/`file`/`image`/`pdf`/`video` **block** in the body, and as an entry
of a **`files` property** on a database row. **The property half is where almost every real file is** —
measured over 40 pdf-bearing pages, a block-only read found a file on 1 of them and the whole
read on all 40, because a CV or a signed form hangs off a row that has no blocks at all.

The **bytes** decide what each one is: a screen recording reads as not-a-document, a scan says it has no
text layer rather than rendering blank. Anything pointing at **another site** is counted in `residue` and
never fetched — those are the largest group in the workspace and they are a video host's or a course
platform's content rather than the page's own. A page's cover and icon are chrome, not attachments, and are
left alone. **Nothing about one file ends the read** — a 403, a file past the ceiling or unparseable bytes
is a line in `attachments` and in `residue`, and the page still comes back whole.

**Writing a file back is `notion attach`, and the SIGIL picks the block.** `![cap](file:./shot.png)` alone on
its line becomes an `image` block, `[cap](file:./doc.pdf)` alone on its line becomes a **`pdf`** block, both
at that exact position and never appended to the end. A mismatch between the sigil and the extension is
REFUSED naming both, because a PDF in an image block renders as a broken image and Notion reports nothing.
`notion page create|update` runs the pass itself; the standalone verb is the repair path and needs `--from`,
since the published page no longer knows which local file belongs where. Re-running attaches nothing already
there. A bare local path stays refused in both spellings — Notion builds a broken block or a dead link from
one and says nothing. 20 MB is Notion's single-part ceiling; `audio` and `video` are deliberately absent.
The round trip is the proof: attach a PDF, then `notion read <url> --pdf` reads its words back out.
[notion-attachments.md](../../docs/notion-attachments.md) is the whole contract.

Two bounds before you ask for it. Block files are opened only from the **slice you asked for** and the blocks nested under it, so a read
with `--after` opens that slice's and no others; and at most **10** files are opened per read, with the
count said out loud when the read addresses more. A signed Notion url is live only inside the read that
produced it, which is why this happens during the read rather than from anything stored.

**What comes back can be somebody's personal data.** A staff member's CV on a row is the measured case. Treat
extracted text as you would the page itself: it is fine to read and reason over, and it does not go into a
pull request, a test fixture or a message.

**A page longer than 100 top-level blocks is read in slices, and you must ask for the rest.** When
`data.blocks.hasMore` is true the response carries `data.blocks.nextCursor`; pass it back as
`--after <cursor>` to get the next slice, and repeat until `hasMore` is false. The cursor is Notion's own
opaque token — forward it byte for byte, never parse it as a block id or an offset. One inherited limit, measured: the shared flag parser refuses any value beginning with `--`, so a cursor of that shape cannot be passed (`--after=--x` answers `--after requires a value`). Notion cursors are UUID-shaped, so this is not reachable in practice — but do not describe the forwarding as unconditional.

```bash
slopweaver notion read <page-url> --limit 100 --json          # first slice
slopweaver notion read <page-url> --limit 100 --after <cursor> --json   # and again while hasMore
```

**A short slice is not a terminal signal** — only `hasMore: false` is. This matters: one measured
incident-management SOP is over 100 top-level blocks, and a reader that stops at the first slice answers
incident-response questions from a fraction of the document while sounding complete. `--after` is a page
flag; a database read has no block children and refuses it.

Use `--kind database` only when the address is a database. It retrieves the database object and deliberately
does not traverse rows, linked pages or data sources. The Notion Atlas and exhaustive reachable crawl are a
separate programme; this verb must not grow a second crawler.

Both paths use the official Notion SDK, the shared provider wrapper and the credential from the selected
`--home`. Never substitute raw HTTP, a browser scrape, provider MCP or a second client when this typed reader
refuses an address.

## A page is NOT done until `notion verify` has run

`notion page create|update` and `notion attach` all end by printing the exact command. Run it. A write
that reported success has told you Notion ACCEPTED your markdown — it has told you nothing about what a
reader sees, because Notion's own converter, not the body, decides that. `notion read` shows the blocks it
built, not how they render, so the markdown you sent is not evidence about the page and never was.

`slopweaver notion verify <page-url>` opens the page in a visible browser on its own persistent profile,
screenshots the whole page plus every table and mermaid block, and reports link cells that did not render as
links, links whose TARGET is malformed while looking fine, mermaid blocks not showing their diagram, and rows
past a stated line budget. Read the exit code: `0` clean, `3` it checked and found problems, **`1` it could
not check at all — never report that as a pass.** The first run on a machine needs `--login` once; the
profile persists after that.

Never substitute a screenshot you took another way, a description of the markdown, or a claim that the body
looks right. Those are what this verb exists to replace.

## Writing a page: the lead is gated

`notion page create|update --body <md>` publishes markdown. Everything before the body's FIRST heading is the
lead a reader meets on opening the page, and it goes through the operator's exact voice rules plus the
packing rules — no colon-introduced list, no semicolon-joined clauses, one parenthetical aside, no sentence
over 30 words. It REFUSES rather than trims, reports on `--dry-run`, and the `voice-rules` hatch is
the one deliberate exception. Everything from the first heading down is never scanned by those rules.

**Every Notion write is judged by the outbound privacy check at the transport, AFTER the door.** The whole body,
title, icon, a caption, a move, a block delete and an upload (its name, type and a text-like file's bytes) are
refused before the wire on a private term from `$SLOPWEAVER_HOME/hygiene/private-terms.tsv` or a dead Datadog
console host, and every write is refused while that file is absent. A term on a row carrying the owner's meaning
HOLDS a page or block write for a review in context instead, printing its `private-terms review-prepare` step; an
upload refuses outright. A refused create is reported failed and its
reservation released, so reword and re-run; a dry run crosses no transport, so it never refuses for these.

**Never write a bare PR number or ticket key — always a link.** `#<n>` and `ABC-<n>` typed as plain text in
the body are resolved into a real markdown link automatically wherever the repo (or the connected Linear
workspace, for a key) is unambiguous; a reference the door cannot resolve is REFUSED rather than sent bare,
naming each one. The `bare-refs` hatch is the journalled break-glass. This runs over the WHOLE
body, not only the lead.

## `move` re-parents a page, and is the one write that gates differently

`notion page move --page <p> --to <parent>` changes where a page hangs. Its id, its URL and every block
survive, so nothing that links to it breaks. Because it destroys nothing, it does **not** take the
external-edit refusal below — a page a colleague has been editing all week moves with no flag. It still
needs the page to be slopweaver's (`--adopt` recovers a lost create, same as `update`), it refuses to make a
page its own parent, and a page already under `--to` reports `unmoved` with nothing sent.

Two things it will tell you rather than assume. A move reads the parent back afterwards and claims `moved`
only when the page itself agrees; an accepted move that landed elsewhere is `unconfirmed`. And a moved page
inherits the DESTINATION's permissions, so its audience changes — the report says so, and `--dry-run` says
so before anything happens. `--dry-run` is real for `move` and `archive`: it never reaches the live lane.

## `update` refuses an external edit — but a human TOUCH is not always a human EDIT

`notion page update` and `notion attach` both refuse when anyone but the integration last edited the
page, because an update replaces the page's whole content and would destroy that edit. But Notion rewrites
`last_edited_by` on some actions the API exposes no content for at all — a mermaid diagram's display-mode
toggle is the measured case — so a byte-identical canonical read is treated as no edit at all and the write
proceeds with no flag needed. A genuine content difference still refuses, naming who touched the page and
when, and needs `--overwrite-external-edit "<why>"` to proceed; the reason, and who last edited the page and
when, are journaled to `$SLOPWEAVER_HOME/ledgers/notion-pages/external-edit-overrides.jsonl`. Never invent a
raw HTTP call or a second client to route around this refusal — the flag is the door.

**One thing byte-identical cannot see, and the write says so.** A table's COLUMN WIDTHS are layout and never
appear in Notion's markdown, so a colleague who drags a column wider reads as a byte-identical touch and the
update — which replaces every block — resets them. The write still proceeds, and prints a line naming what
it could not see, but only over a page that actually carries a table. Read that line; nothing else will tell
you.

**Do not reach for the Notion MCP server instead.** It reaches the same API and adds none of the ownership,
at-most-once or read-back checks these verbs exist for, its `in_trash` field makes trashing a page a
parameter on an ordinary update, and its 24 tools cost 76 KB of context against this noun's 5.5 KB —
measured, [docs/notion-mcp-benchmark.md](../../docs/notion-mcp-benchmark.md).

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.

Use the world model only for bounded history and discovery; it cannot establish current Notion state.
