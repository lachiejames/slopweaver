# Images and drafts inside a react-now card

Bundled reference for the `supervisor` skill, linked from
[fleet-briefing-shape.md](fleet-briefing-shape.md). Loaded when a card carries a screenshot or a draft, not
on every turn. The third block kind a card shows inline, a value the owner must copy, is
[paste-blocks.md](paste-blocks.md).

## Images render INSIDE the card, never a file path

On a react-now card carrying a drafted Slack post with screenshots, they must render INSIDE the card so it looks
like the Slack post would if sent, never a file path the owner has to go find. A fold's `blocks` may carry an `{ "kind": "image", "alt": "…", "caption": "…"?, "path": "…" }` entry —
write `path` (a local file) and `briefing render` embeds it as a `data:` URI before the schema ever sees the
form; write `data` directly (an already-encoded `data:image/(png|jpeg|gif|webp);base64,…` URI) when there is
no local file to read from. `alt` is required; `caption` is optional.

**Text then images, never the reverse.** Once an `image` block appears in a fold's `blocks`, every block
after it must also be an `image` — the way a Slack message reads its own text first and its attachments
after. Put every `para`/`list` block ahead of the screenshots.

**A fold costs bytes even when it costs no words, so the folds are capped too.** Measured: 489
uncapped `earlierToday.notes` were 681 KB of a 690 KB page, chunk-read by every fresh supervisor before its
first publish. A section holds 30 notes, `history` 4 sections, `render` refuses over 256 KiB of text, and the
remedy it names, `slopweaver briefing archive --form form.json`, moves the oldest notes to a dated file, reading
the chair's form newest-first and cutting its END. `supervisor tick close` needs no hand step for either cap: it
archives to 28 notes before the sweep block, and on a page `render` refuses as too large it moves more of the
oldest notes into the same `tick-<n>/briefing-archive.json` and renders again, down to one note (once
27 notes weighed 157 KB and the count trigger never fired).

**Two size caps, both in `src/briefing/caps.ts`.** One image may carry at most `IMAGE_MAX_BYTES` (4 MiB raw,
before base64) — resize or recompress a screenshot over that. The whole page may embed at most
`IMAGE_TOTAL_MAX_BYTES` (9 MiB raw, summed across every image) — the Artifact publish contract behind this
page caps a whole rendered page at 16 MiB including every `data:` URI, so both caps leave headroom for the
page's own HTML and CSS. Three unusually large screenshots on one card is exactly the case the total cap
exists to catch; drop one or resize the largest rather than trying to raise the number.

## Drafts render INSIDE the card too, as the surface would show them

The same holds for drafts: a draft the owner is asked to approve — a Slack message as the owner
today, a Notion body or a pull-request description later — is shown INLINE in the card's fold, never a file
path the owner has to go find. A fold's `blocks` may carry a `{ "kind": "draft", "surface": "slack-as-me", "text":
"…" }` entry. `text` is the surface's own words, not a run vocabulary — the renderer frames it, never rewrites
it — and `\n\n` reads as the paragraph gap the wire it was drafted for uses, a single `\n` as a line break
within one. Its cap is `slack-as-me`'s own — `SLACK_MESSAGE_TEXT_MAX` in `src/outbound/slack/dripRender.ts`,
imported rather than restated. `briefing check` refuses a card fold naming a filesystem path instead. This is
the draft a CARD carries — a briefing card, or the queue card over a draft parked with `slack draft record`,
where an unasked message to a person waits (rule 10). A preview the owner asked to see rendered as
real messages goes to the owner's bot DM instead; [draft-review](../../slack/reference/draft-review.md) is the routing.
