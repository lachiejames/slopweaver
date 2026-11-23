# Verifying a change to the site

Part of [The local docs site](../docs-site.md).

**`next build` is the only thing that typechecks `site/`**, and CI runs it: the `site` job in
`.github/workflows/ci.yml` runs `yarn build` in `site/`. It is a worker of the required `build` check, so a
red console build reddens `build` and cannot merge. The same build runs here with:

```bash
bash scripts/docs-site.sh --build
```

Two failure classes it is the only thing that catches, both measured: JSX text containing an
angle-bracketed placeholder (`atlas <platform> report`) parses as a tag and has to be written as a string
expression, and a coordinate passed to a figure primitive as `x="176"` fails that primitive's `number` —
the primitives do arithmetic on those, so a call site writes `x={176}`.

**A build INVALIDATES every visual proof taken afterwards off the same tree.** `--build` opens with
`rm -rf .next`, and a dev server already serving that tree keeps answering — it just no longer resolves
`var(--sw-figure-panel)` or any `var(--sw-stage-*)`. Every figure then renders as black boxes in a serif
font, with no error anywhere: not in the build, not in the server's log, not in the browser console.
Measured on a set of ten screenshots and two overflow sweeps taken after a build and all of
them worthless. So take the visual proof BEFORE the build, or kill the server, `rm -rf site/.next` and
restart it after — and either way check rather than trust, because a stale shot and a fresh one differ
only in a way you have to be looking for:

```js
// in the page, once per colour scheme
getComputedStyle(document.querySelector('.sw-figure svg rect[fill="var(--sw-figure-panel)"]')).fill;
// → rgb(241, 245, 249) light and rgb(226, 232, 240) dark, measured on /docs/fleet/autonomy-ledger.
// Anything else — a bare `var(...)`, or black — means the stylesheet is gone and the shot is worthless.
```

## Nothing here wraps, so nothing here warns

SVG text does not wrap and does not report being too wide. A string longer than its panel or its viewBox is
drawn straight past the edge and cropped by the frame, so the page renders a **shorter sentence** rather than
a broken one — no console warning, no build error, and nothing in the diff to notice. Nine text nodes across
seven figures once shipped that way, one of them losing the entire claim its figure was drawn for
(`browserSurface.ts` "refuses a doored provider reached by hand", invisible past the right edge).

Two things hold it down. `Panel` takes `string | readonly string[]` for its `detail` and `foot` slots, so
a caller breaks its own line and the primitive keeps the two from colliding — `detail` flows down from the
title, `foot` flows up from the bottom edge, and adding a line to either never moves the other. A bare
`<text>` written outside a primitive has to be re-measured instead of trusted, and this is what measures it:

```bash
bash scripts/docs-site.sh --overflow                          # reuses a live server, or starts and stops one
bash scripts/docs-site.sh --overflow http://localhost:3000    # or point it at a server you already have
```

With no base URL it reuses this worktree's recorded server when one is up, and otherwise starts one and
**stops exactly the one it started** when the sweep ends — including when it fails. That cleanup is the
whole reason the [run record above](runtime.md) exists.

It loads every route the content tree declares and makes three measurements per figure, because the first
of them alone is weaker than it looks. Text past the **frame** is the clipping one. Text past its own
**panel** is invisible to that check — a card anywhere but hard against the right edge can spill across the
card beside it and still sit well inside the viewBox, which is how `CorpusTiers`' foot ran 44.5 units over a
176-unit panel while every frame check passed. And two stacked lines that **collide** are compared only
where they share horizontal ground: a left-anchored and a right-anchored label on one baseline sit side by
side, and reading that pair as a collision was this check's own first false positive, on four figures at
once. It is hand-run, not a gate: CI's `site` job builds the site but serves nothing, and the sweep needs a
live server.

**From a worktree, serve your own and point the sweep at THAT.** The page list comes from `site/content` in
the checkout you run it from; the pages themselves come from `base`, which defaults to `:3000` — and `:3000`
is usually the main checkout's server, which does not have your new routes. It answers 404, a 404 carries no
`.sw-figure`, so nothing is measured and the run exits clean. The count it prints is the number of FILES it
found, never the number of pages that rendered, so a green sweep over work that was never loaded looks
identical to a green sweep. `bash scripts/docs-site.sh --port 3001` falls through to the nested dev server;
sweep `http://localhost:3001` and name the port in the proof.

Measure the painted box, never `getBBox()`. `getBBox()` reports a node's extent in its own space **before**
its transform, so a rotated label reads as 14 units past the right edge while sitting comfortably inside it —
the first version of this sweep reported exactly that false positive on `ModuleLayout`'s "DEPENDS ON", and
chasing it would have meant redrawing a figure that was already correct.
