# Measuring a page's layout before the owner opens it

How to find out what a page's boxes actually do, before the owner reads it. **Reading the CSS tells you what a rule
says; rendering tells you what the box does.** Neither substitutes for the other, and the author's own look is
the weaker of the two: ten pages once went through one review seat and **five carried a narrow-width
defect** whose authors had each checked their work carefully. What the instrument finds, and the fixes, are in
[narrow-width.md](narrow-width.md).

## Reproduce the shell before measuring

`slopweaver page publish` wraps the fragment in `src/pages/shell.ts`, which zeroes the body's margin and — for a
fragment with no stylesheet of its own — pads the body into the house column ([house-style.md](house-style.md)).
Load the bare fragment instead and the user-agent default adds 8px, so every width reads 8px wide — that
constant once explained one reviewer's 840 against another's 832 — and a house-styled page loses its whole
column. **Measure the published `file://` address**, or the fragment inside the same shell, never the fragment
alone.

**Measure before AND after, over the same widths, in one run each.** A table mixing a post-fix number into a
pre-fix column once reported a width clean that was not.

## The ladder: 1280 / 768 / 430 / 375 / 320, twice

Run every width **at rest, then again with every fold open**:

```js
document.querySelectorAll("details").forEach((d) => (d.open = true));
```

A closed `<details>` is `display: none`, so nothing inside it exists to an overflow probe — a page reads clean
at every width and breaks the first time the owner expands a section. Measured: `scrollWidth 322` at rest at
320, **340** with three folds open, from one 65-character `<code>` token. Progressive disclosure puts the dense
content in the folds on purpose, so the folds-open pass is the one most likely to find something, and an
author's single look at rest cannot show it even in principle.

## Count UNCLIPPED overflow, not overflow

Walk every element and **skip any with an ancestor whose computed `overflow-x` is `auto`, `scroll` or
`hidden`**. A wide table inside its own scroller is behaving correctly; without the filter the probe resolves
onto those cells and the real culprit hides among them. That filter is what made the probe usable.

**Read the overflow width across widths before searching for the cause.** A constant overflow (404 at both
375 and 320) is ONE unshrinkable object; an overflow that tracks the viewport is a floor that cannot shrink.
That one reading names the element faster than any search.

**A residual no element box explains is TEXT.** `getBoundingClientRect` misses text painting past its own
in-bounds box. Walk text nodes and take their line boxes:

```js
const r = document.createRange();
let worst = 0,
  hit;
const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
for (let n; (n = w.nextNode());) {
  r.selectNodeContents(n);
  for (const b of r.getClientRects())
    if (b.right > worst) {
      worst = b.right;
      hit = n.parentElement;
    }
}
```

Pair it with a container walk — `scrollWidth > clientWidth` on elements whose `overflow-x` is `visible`. That
pair named a 40-character commit sha in a `<footer>`, 3px past a 320 viewport.

## A body that does not scroll can still be unreadable

`scrollWidth == clientWidth` answers _does the body scroll sideways_. It cannot see a **squeeze**: content that
fits its box while the box is far too narrow to read. Five width passes once called a page clean and the owner then
screenshotted a code block rendering one character per line, at every width from 1280 down.

The squeeze check, its threshold earned by measurement: for each leaf holding 8+ characters, take rendered
lines as `height / lineHeight` and flag `lines >= 3 && width < 140 && chars / lines < 6`. A first version on
width alone (`< 120px && > 12 chars`) threw five false positives on a clean page. **Validate a detector both
ways**: zero hits on a page known good, and a hit on the known defect (this one returns `w=22 lines=22 ch=22`,
the element in the owner's screenshot). A check that has only ever fired on the case it was written for is untested.

**Count lines from the text, not the box, wherever a sibling sets the height.** A `<td>` stretches to the
tallest cell in its ROW, so `height / lineHeight` counts the neighbour's lines — four cells flagged at every
width up to 900, all false. `range.selectNodeContents(el); range.getClientRects().length` gives the real line
count. The same applies to `align-items: stretch` children. Keep those in a separate suspect bucket until the
Range count settles them.

## Prove the probe touched what it claims

**A diagnostic override that matches no selector is indistinguishable from a fix that does not work.** A
candidate fix typed against `.cards` when the class was `.pair` left every number unmoved and nearly got a
correct one-liner reported as a failed one; the only tell was 300px getting WORSE, which a no-op cannot do.
So a probe reports `selectorExists` beside its number, and the resolved property beside the outcome — a grid
collapsing 3 → 2 → 1 columns as the viewport narrows is the mechanism firing, while "zero overflow" alone is
equally true of a rule that never applied.

**When an override changes nothing, read back the COMPUTED value it sets** before concluding anything. Three
`min-width: 0` attempts on a flex child gave byte-identical numbers because `flex` still computed `0 0 auto`;
the width moved only once the override actually applied.

**Prove a cause by overriding the one declaration live and re-measuring**, never by reading the stylesheet.

## Without a render: isolate by clearing the class first

A session with no render finds defects by parsing and arithmetic, and the order that works is not the
obvious one:

- **Clear the class before isolating the culprit.** A grid or flex child defaults to `min-width: auto` and will
  not shrink below its min-content, so a leaf-level probe finds a dozen suspects. Applying `min-width: 0` and
  `overflow-wrap` broadly FIRST leaves the one element still overflowing, which makes it findable. Broad
  hardening here is an instrument, not the lazy alternative to isolation.
- **Exclude anything with a scrolling ancestor**, exactly as the live probe does — it is the commonest false
  trail.
- **Sweep a RANGE, never one estimate with a caveat.** Estimating SVG label widths at 0.52em said "fine, but";
  sweeping 0.52 / 0.55 / 0.58 showed four labels clipped by up to 21px. The caveat is the part a reader drops.
- **Assert the invariant in the generator** when a page is built by code — throw when the count of wide tables
  differs from the count wrapped in a scroller, rather than trusting a later look.

When a session that can render re-measures after a change, hand it the CHANGED MECHANISM and ask it not to
carry the earlier measurement forward.

## Then ask whether the overflow is a symptom

The last culprit on one page was a 36-character sentence inside a label pill whose siblings were all 14–18
characters. It was wrong at 1280 too, where nothing overflows and no measurement reports it; the CSS one-liner
would have made the page measure clean and left a malformed pill on the owner's desktop. **Fix the content that made
the element that shape, as well as the rule, and say which is which.**

**Reject a fix that passes its test and fails its purpose, and say so.** `.rail-note > span { min-width: 0 }`
stopped the page scrolling and made four pills spill their own boxes by up to 114px.
