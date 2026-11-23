# Diagrams: hand-authored SVG, and the bar they have to clear

Part of [The local docs site](../docs-site.md).

The renders the owner rejected were **a tool's default theme**, not a file format: pale fills carrying pale text,
on a figure that had inherited a dark page and lost its contrast. Swapping D2 for another generator makes
the same bet again — that a generator's layout and palette will clear a bar nobody has written down. So the
diagrams in `site/components/diagrams/` are hand-authored inline `<svg>`, and "we adopted D2" never settles
how a figure looks. A figure ships only if it would survive a presentation sign-off: readable contrast, one idea
per level, and drill-down pages from one top-level picture rather than one dense image. The bar is these rules:

- **Every figure draws on its own light card, in both themes** (`site/app/diagram.css`). A saturated fill
  with white text then reads identically whichever ground the reader is on.
- **Three stage hues and one refusal hue, and nothing else.** `--sw-stage-in`, `--sw-stage-mid`,
  `--sw-stage-out`, plus rose for a refusal. A colour means a stage; it is never decoration.
- **Labels at 13px or larger** at drawn scale, and **every arrow carries a verb**.
- **One figure, one claim** — `<figure>` + `<figcaption>`, `role="img"` and an `aria-label` carrying the
  same claim.
- Size by `viewBox`; no scripts, no `<foreignObject>`, no external images.

`.oxlintrc.jsonc` carries one override for `site/components/diagrams/*.tsx`: `jsx-a11y/prefer-tag-over-role`
is allowed there, because its suggested fix for `role="img"` on an `<svg>` is an `<img>` tag — a raster
file, and the end of `currentColor` theming. The reason is written at the override, not here.

**`docs/diagrams/*.mmd` stand beside these.** Those nine are agent-facing and render in GitHub's own
markdown viewer, which this site does not replace. Each is drawn on one page: the overview in the README, seven on their own pages under `docs/architecture/`, one each, [listed in architecture.md](../architecture.md#diagrams), and the voice flow in [voice-flow.md](../voice-flow.md).

## The page tree IS the progressive disclosure

The root of the site is the console, not a doc, by the owner's ruling: `site/app/(console)/` is a root layout
of its own serving `/queue`, `/pull-requests`, `/fleet`, `/workstreams`, `/alignment`,
`/automations` and `/view` (Settings is a modal over every page, and holds Plans), and
`site/app/(docs)/` is Nextra's, serving every `content/` page under `/docs` through
`contentDirBasePath: "/docs"` in `next.config.mjs` (the docs layout reads `getPageMap("/docs")`; the
catch-all's `importPage` stays unprefixed because Nextra strips the base from import keys). Two root
layouts rather than one shared `app/layout.tsx`, so the docs theme's stylesheet never lands under a console
page; the cost is a full document navigation between the two. `next.config.mjs` redirects `/` to the Queue and
each docs group from `/<group>` to `/docs/<group>`, listed one by one so `/api/*` and the console's routes are never
swallowed.

Under `content/`: one top-level picture at `index.mdx`, then `console/` — a derivation page for each console
page or surface the owner reads, the in-app `/view` aside (`queue`, `pull-requests`, `fleet`, `workstreams`, `board`, `alignment`, `automations`,
`machine`, `setup`, then `steers` for the Alignment page's steers, `talk` for the voice and
`settings` for the Settings modal) and an `index.mdx` saying what
the console is and the line it keeps — then five groups, ordered by the question a reader arrives with
rather than alphabetically; the console pages themselves are in [console.md](../console.md). `content/_meta.ts`
and one `_meta.ts` per group carry that order; the ladder is **what it does → how the console is derived →
what it knows → what it may do → how the fleet runs → how it is built**, and a reader who stops after the
first group still has a true picture.

```bash
find site/content -name '*.mdx' | wc -l          # the pages
ls site/components/diagrams/*.tsx                # the figures
```

Counts are not written down here on purpose — they rot within a week, and those two commands answer faster
than a doc can. What is fixed is the shape: `phases/` (the turn), `model/` (the world model, its coverage bounds,
people and identity, the store, retrieval, the atlases, the knowledge ledger, and the brief it was built
against), `trust/` (security, the door, the verdict it returns, the browser as a write surface, what
refuses before a tool runs, the ten doctrine rules, the outbound formats, the voice rules, graduated
autonomy), `fleet/` (sessions, reaching a seat, the supervisor sweep, the board, automations, the
autonomy ledger, Codex pairing, proof and landing, the merge queue) and `build/` (the verb surface, skills,
modules, gates, testing, error handling, known debt, running it).

## The verb list is READ, never transcribed

`content/build/verbs.mdx` renders `slopweaver catalog --json` live, through the same allowlisted route the
console tiles use (`site/lib/liveVerbs.ts`, slug `catalog`). A hand-written command reference is stale the
day it lands, and a stale command reference is a confident lie to whoever reads it next — so the surface
documented and the surface installed cannot disagree. The page carries a filter over the whole command
line, because a reader looking for a capability rarely knows its noun.

The two dispositions the catalog already publishes per row — `externalWrite` and `createsWorkItem` — are
surfaced as badges, since they are what a reader needs before running something they just found.

## The mark is THE OWNER'S, traced from the file the owner supplied

`site/components/SlopweaverMark.tsx` and `site/app/icon.svg` are the owner's own Slopweaver logo. The source is
the 200x200 PNG the owner pasted into the supervisor chat, kept under the state home rather than in git. A
near-black square, two light rounded bracket strokes with 180-degree rotational
symmetry, a cyan square at the centre.

It is a **trace, not an embed**, so the mark stays a vector at every size a browser tab and a navbar ask
for. Every number in it is measured off that file: a 23-unit stroke whose centreline runs along 43 and 157,
turning on a 38-radius quarter arc centred at (81, 81), inside a 200-unit viewBox. The colours are the
file's own — `#0a0a0a` behind, `#eaeaea` for the strokes, `#22d3ee` for the square.

**The trace was checked rather than assumed.** Rendering `app/icon.svg` at 200x200 in a browser and
comparing it to the PNG channel by channel gives a mean delta of 2.25 of 255, and 1.44% of pixels differing
by more than 60 — every one of those on the antialiased boundary. Reproduce by screenshotting the file at
200x200 and diffing the two decoded bitmaps.

`#1a1a2e` is not the mark's colour: it is the bot Slack app's own background. A session that finds it
cited as the mark's anywhere should delete the citation.

The DRAWING is kept identical across the two by hand, because `app/icon.svg` is read by the browser tab and
cannot import a component; six elements copied is the cheaper wrong thing than a build step that generates
one. Only the accessibility differs, and deliberately: the favicon carries `role="img"` and a label because
it is the only thing naming the site in a tab, while the navbar copy is `aria-hidden` with the word
"Slopweaver" beside it.
