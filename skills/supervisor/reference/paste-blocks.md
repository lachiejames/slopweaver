# Paste blocks — anything the owner has to copy gets a copy button

Bundled reference for the `supervisor` skill, linked from
[fleet-briefing-shape](fleet-briefing-shape.md). Read it when a card asks the owner to move a value somewhere else.

## The ruling

A card whose fold asked the owner to paste 25 read-only Google Admin scope URIs into one console box should have
been a simple copy-button click: it was hard to read and the overflow was ridiculous. A general briefing UI
improvement, not urgent.

MEASURED on that card: its fold rendered the scopes as 26 inline `code` runs inside one paragraph, the last
of them the comma-joined line the owner actually had to paste — **1,725 bytes on one line**. A `code` run was
`white-space: nowrap` in the page chrome before the fix, so that one run widened the page BODY and every
line on the page offset sideways, and nothing offered to copy it.

## Write it as a block, never as runs

```json
{ "kind": "paste", "label": "the 25 scopes, comma separated", "text": "https://…/a.readonly,https://…/b.readonly" }
```

- **`text` is the exact bytes**, one opaque string with no run vocabulary. Nothing re-spaces, splits or
  emphasises it, because it is what the owner pastes — the same discipline a `draft` block carries for a surface's
  own words. It is the ONE place in the form where the packed-enumeration and ellipsis refusals do not apply:
  a value that reads like a numbered list is still the value.
- **`label` names what it is**, in the owner's words. It is the only text around a `<pre>` a reader meets, and it is
  held to the same short-line rule a fold's own `summary` is.
- **The renderer owns the control.** It emits the button, its words (`copy`, then `copied`), and no `id` —
  one delegated listener in the page chrome wires every button on the page, so a card that moves keeps
  working. You supply what the block IS, never its markup.
- **The cap is `PASTE_MAX_BYTES`** (4 KiB, `src/briefing/caps.ts`) — over twice the measured scope line. Link
  the file instead when a value is bigger than that; a paste block is one value the owner moves into one box.
- **A paste block always sits inside a fold**, like every other block, so it spends none of anyone's
  above-the-fold word budget.

## Nothing on the page scrolls sideways

The other half of the same ruling, and it is in the stylesheet rather than the form: a `code` run is
`overflow-wrap: break-word` — a token that fits still sits on one line, and one that cannot fit breaks
instead of pushing the document out — and a paste block's `<pre>` is `pre-wrap` with `overflow-wrap: anywhere`,
scrolling VERTICALLY inside its own box. `briefing check` cannot see either rule, because it strips `<style>`
and `<script>` before it measures anything; `src/__tests__/unit/outbound/briefing/chrome.test.ts` reads both
back off the bytes the chrome ships, and that test is the gate.

Where the browser has no clipboard — an insecure context, or a refused permission — the button selects the
text and says so, rather than doing nothing. A copy control that silently fails is worse than none.

## What applies inside a paste block

`briefing check`'s fold-residue scan reads a card's whole fold, paste blocks included, so a filesystem path
inside one is reported as residue with the advice to write a `draft` block. That is deliberate rather than an
oversight: the case has not come up, and scoping a live gate around a block kind on a
hypothetical is how a gate quietly stops covering what it was built for. If a real paste block ever needs to
carry a path, change the scan there with that case as the evidence.
