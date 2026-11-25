# Images and PDFs in a Notion page, at the position they were written

A Notion page slopweaver publishes is **markdown in, blocks out** — Notion's own enhanced-Markdown
endpoints do the conversion (see [`architecture.md`](architecture.md) and the module comment in
`src/corpus/notion/writeApi.ts`). That works for everything the golden proposal shape uses except one
thing: a file that is not already on the public internet.

This is how a local image or PDF gets into such a page, **at the position it was written**, rather than
appended to the end.

## The contract, in two lines

```markdown
![The retry column, with the four repeat failures boxed in red](file:./shots/hero.png)
[The signed DPA, countersigned 1 Jan 2001](file:./dpa.pdf)
```

`file:` means _upload this_. The path is relative to the markdown file the body came from. That is the whole
authoring surface.

**The sigil picks the block, and the extension has to agree.** `!` asks for an `image` block, no `!` asks
for a `pdf` block, and a mismatch is refused naming both — because a PDF in an image block renders as a
broken image and Notion reports nothing at all. `pdf` is Notion's own block type, not a generic `file`
one, and it is the type `notion read --pdf` already extracts text from, so what this lane writes is read
back by a reader that shipped before it.

`audio` and `video` blocks are **deliberately absent** rather than pending. Nobody asked for them, and the
read lane calls a screen recording not-a-document, so writing one would emit a block this repo's own
reader skips on purpose.

## What actually happens

1. **At publish**, every `file:` placeholder is replaced — in place, on its own line — by a marker
   paragraph: `[slopweaver-image:<16 hex>]`. Notion converts that to an ordinary paragraph block, so the
   page's block order is already correct before any image exists.
2. **Straight afterwards**, the attach pass reads the page's blocks, and for each placeholder:
   uploads the file (`fileUploads.create` → `send`, polling `retrieve` until `uploaded`), appends its own
   `image` or `pdf` block with `position: { type: "after_block", after_block: { id: <marker> } }`, then
   deletes the marker.
3. **Then** the page is read back and the ownership ledger records the digest of the _finished_ page.

Step 3 is not bookkeeping. Attaching changes the page, so a run that recorded the digest before attaching
would make the very next `notion page update` refuse the page it had just written.

## The ordering guarantee, and why it needed one

The constraint: in Notion the ordering of blocks matters, so images are inserted after the block they belong
to, never all appended to the end.

`blocks.children.append` appends by default. The `after_block` position is what makes it insert instead, and
it was measured against a real page before this was built: the image lands immediately after the named
block and every following block stays where it was. That measurement is the reason the deprecated `after`
parameter is not used.

## Running it

Nothing extra to run for a normal publish — `notion page create|update` and `proposal publish` do the pass
themselves:

```bash
slopweaver notion page create --parent <page> --title "…" --body draft.md
slopweaver proposal publish draft.md --intake <id>   # under the install's `proposal destination`
```

A dry run lists every placeholder and where its image will land, and uploads nothing:

```bash
slopweaver notion page create --parent <page> --title "…" --body draft.md --dry-run
```

The standalone verb is the **repair** path — for a publish where one shot failed, or a page whose images
were never attached:

```bash
slopweaver notion attach --page <page> --from draft.md
```

It needs `--from` because the published page does not know which local file belongs at which position;
the authored markdown is the only thing that does.

When the body is piped on stdin there is no file to be relative to, so pass `--media-base <dir>`.
`proposal publish` does exactly that, with the draft's own directory.

## Re-running is a no-op

**An absent marker means the file is already there.** So running the pass twice attaches nothing the
second time, and a run where the third of five files failed is finished by simply running it again — the
two that landed are left alone, because their markers are gone.

**A marker that is STILL there is read by what follows it, never by its own presence.** Inserting the block
and deleting the marker are two requests, so a marker survives two states that look identical from the
marker alone: the upload never happened, and the upload happened and only the delete failed. The second is
decided by the marker's next SIBLING under the same parent — if that block is already one of the types this
lane writes, the file landed, so the re-run deletes the leftover marker, counts the file as already
attached, and uploads nothing. Without that check a re-run put a second copy of the document on the page and
reported it as a fresh attach.

That is also why a per-file failure does not sink the batch: what can attach does, what cannot is reported
with its reason, and its marker stays on the page as the record that it never landed. The verb exits
non-zero, and `notion page` reports the publish as `partial` rather than `created` — the page is on Notion,
but the document is not finished, and those are different claims.

## What `update` does with images

**It re-uploads them.** `pages.updateMarkdown` with `replace_content` deletes every block on the page,
images included, and rewrites the body from the markdown — which carries the placeholders again, so the
markers come back and the pass runs again from the local files.

Re-referencing the previous `file_upload` id was considered and rejected: the local file is the source of
truth, a re-upload is unambiguous, and an id whose attachment lifecycle Notion owns is not something to
build update-safety on. The ledger's `images` list is therefore an **audit record** — which blocks on the
page are tooling-owned and which local file each came from — never an input to the next write.

## The digest, and the signed-URL trap

`pages.retrieveMarkdown` renders an uploaded image as a **pre-signed S3 URL**, and it is re-signed on every
read. Measured: two reads of one untouched page, 1.5 seconds apart, returned different markdown.

The update-safety digest is taken over the canonical read-back, so left alone that would have made every
re-publish of a page carrying an image refuse as "changed since slopweaver last wrote it".
`stableCanonical` therefore strips the query off any image URL carrying an `X-Amz-*` parameter before the
digest is taken. Keyed on the signature rather than on a list of Notion's file hosts, because the
instability _is_ the signature.

The cost, stated rather than hidden: the query string of a signed image URL sits outside the safety check,
so a swap between two signed URLs with the same path would not be detected. The path, the caption, the
position and every other byte of the page still are.

## Limits, and what is refused

Every file is read and checked **before anything is uploaded** — a page half-edited is a page a reader sees
mid-edit, and a missing file is exactly the cheap refusal worth making first.

| Rule                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20 MB per file                                                    | Notion's single-part upload ceiling. Anything larger needs a multi-part upload, which this lane does not do. The refusal says **recompress** for a shot and **split or link** for a document, because an operator who crops a signed contract has damaged the evidence.                                                                                                                                                                                                                  |
| `.png .jpg .jpeg .gif .webp .svg .heic .tif .tiff .ico .bmp .pdf` | What Notion accepts through this lane. Anything else is refused by extension, naming the whole set.                                                                                                                                                                                                                                                                                                                                                                                      |
| The sigil must match the extension                                | A PDF in an `image` block renders as a broken image and Notion reports nothing, so one spelling per kind is what keeps the markdown readable as what the page will look like.                                                                                                                                                                                                                                                                                                            |
| A `pdf` block's bytes must be a PDF                               | An extension is a CLAIM about a file; its bytes are the fact, and the read side of this repo already decides from bytes. A file named `.pdf` that does not open with `%PDF-` refuses the pass, because a `pdf` block holding something else opens as nothing and Notion reports no error. One-directional on purpose: there is no single magic for twelve image formats, and a wrong image renders visibly broken to its author.                                                         |
| The placeholder must be alone on its line                         | An inline image or link inside a paragraph is not a block, so there would be no position to insert at.                                                                                                                                                                                                                                                                                                                                                                                   |
| A bare local path is still refused                                | Notion **accepts** `![cap](./hero.png)` and silently builds a broken external-image block, and builds a **dead link** from `[cap](./dpa.pdf)`. Both measured, neither reported by the provider. The link refusal is keyed on the extension, so an anchor, a `mailto:` and a file type this lane could not have uploaded all pass. The spelling it names follows the EXTENSION — the `!` form for an image — so a reader who follows it literally is not refused again by the sigil rule. |

## Where the lint stands

`proposal lint`'s `heroImageInTopThird` counts a `file:` placeholder as an image, because it is going to be
one. So a draft can pass the gate before its shots have ever been uploaded, which is the point — the lint
judges the document's shape, and the upload is a publish-time concern.
