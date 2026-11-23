# The narrow-width defect class, and its fixes

Half the pages through one review seat carried a narrow-width defect their careful authors
missed. It is a class, not bad luck, and it is invisible on the desktop the owner reads on — which is why nothing
else surfaces it. Every cause below was found by measurement with [render-ladder.md](render-ladder.md); author
the fragment with these rules in from the start rather than waiting for the ladder to find them.

## The causes, most frequent first

| Cause                                                | What happens                                                                                                       | Fix                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| A bare `<code>` with no wrapping rule                | an id or path pushes the page sideways; authors add `word-break` to the classes they watched and miss the element  | `code { overflow-wrap: anywhere; }` — gentler than `break-all`          |
| `repeat(auto-fit, minmax(<fixed>, 1fr))`             | the floor cannot shrink below the content box                                                                      | `minmax(min(<fixed>, 100%), 1fr)`                                       |
| `display: grid` with no explicit columns             | the track takes the min-content of its widest child, so one `white-space: pre` block widens every sibling          | `grid-template-columns: minmax(0, 1fr)` plus `min-width: 0`             |
| `flex: 0 0 auto` on a flex child holding long text   | the child stays at max-content (613px inside a 343px parent, at 430, 375 and 320 alike)                            | `flex: 0 1 auto; min-width: 0` — `min-width: 0` alone does nothing here |
| A grid list item with a marker column                | a grid row puts every child in its own cell, so inline bold, text and code alternate into the narrow marker column | take the marker out of flow (`position: absolute`)                      |
| An unbreakable token in prose outside every scroller | a 40-character commit sha in a `<footer>` sat 3px past 320                                                         | `p, footer, dd { overflow-wrap: anywhere; }`                            |

The marker-column case reads clean on every overflow measure, because nothing overflows: it is a squeeze.
A 22-character environment assignment rendered in a 22px box, one character per line, at every width.

## A scroller needs a viewport AND a floor

A `.scroll` wrapper alone fixes nothing. A `width: 100%` table whose cells carry `overflow-wrap: anywhere`
shrinks to its container, so the wrapper has nothing to scroll and the narrow column still collapses. **The
wrapper provides the viewport; a `min-width` on the child provides the thing that exceeds it** — both or
neither. Measured on a 110 KB page with 14 of 15 tables unwrapped: `squeezed=14` at 320, one citation column
twelve lines tall in 33px; with `.scroll` and `table.ep { min-width: 26rem }`, `squeezed=0`.

**Wrapping an element breaks every selector that named it as a direct child** — `details.row > table.ep` had to
become `details.row > .scroll`. A tag-balance check passes straight through that, so re-run the ladder after
wrapping rather than trusting the markup.

## A long token is dangerous only when it is UNBREAKABLE

The class is an unbroken run, not a long token. **A hyphen is a break opportunity in normal wrapping**, so a
55-character kebab-case slug wraps cleanly at 430 / 375 / 320 under `word-break: normal` — its longest
unbreakable run is ten characters. Kebab-case is close to the safest long token there is, and adding
`word-break` for one is a fix aimed at a case that never had the defect. What bites is a run with no break
opportunity at all: a sha, a UUID, a base64 blob, a separator-less path, a long camelCase identifier.

**Measure the run the way the renderer sees it.** Strip tags, decode entities, split on whitespace, then take
the longest run with no hyphen or separator. Two scans of one file once disagreed by 29 characters: one split on
`<` and ended the token at `&lt;name&gt;`, reporting 36; stripping tags first kept the entity inside the token
and reported the true 65 — the browser does not break there either. A tokeniser that splits where the renderer
does not is what makes a wrap rule look unnecessary.

Flag a suspect token before publishing and measure it, rather than either fixing it blind or hoping. The
answer "safe, for a reason worth knowing" is what makes the next page predictable.

## A command a reader is meant to run must survive 320

A page that cites the command reproducing a claim ([page-consistency.md](page-consistency.md)) has made that
command part of its content: a reader tries it. One rendered as a clipped column is a command nobody runs, and
the citation collapses back into the assertion it replaced. Measure its longest unbreakable run like any other
token — a 43-character command cleared 320 on the page where this was checked.
