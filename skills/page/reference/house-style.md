# The house style — what a page with no stylesheet of its own reads in

`slopweaver page publish` wraps every fragment in `src/pages/shell.ts`. When the fragment brings no `<style>`
and no stylesheet link, the shell's `@layer house` design applies; when it brings either, the page gets only
the plain platform reset and looks exactly as its author wrote it. The choice is a CSS `:has()` on the body,
so there is nothing to declare: write no CSS and the house design is yours. The correction stylesheet
`briefing corrections` stamps does not count as the author's.

The CSS itself is the source of truth; this page names what to reach for, not its property values.

## What plain HTML already looks like

| Write                          | You get                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `<h1>` then a `<p>`            | a serif hero title, and that first paragraph set large as its lede       |
| `<h2>`                         | a new section: a rule across the column and a short accent mark above it |
| `<h3>`, `<h4>`                 | a sub-heading; `h4` is a small uppercase label                           |
| `<table>` with a `<thead>`     | a card: rounded, lifted, an uppercase header row, rules between rows     |
| `<figure><img><figcaption>`    | a framed image with a muted caption under it                             |
| `<blockquote>` (`<cite>` last) | a quote card with an accent edge; the cite is its attribution line       |
| `<details><summary>`           | a fold drawn as a card, its summary the clickable line                   |
| `<pre>`, `<code>`, `<kbd>`     | monospace on a soft ground; `pre` wraps rather than scrolling sideways   |
| `<mark>`                       | a highlighter stroke                                                     |

The column is the body's own padding: 88% of the window, at most 140ch, the measure the owner ruled for the fleet
briefing. A narrow window keeps a 1.25rem gutter, and a wide table scrolls inside itself below
40rem rather than widening the page.

## Classes worth reaching for

| Class                                          | For                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `eyebrow` (or `kicker`)                        | the small uppercase line ABOVE the title — what kind of page this is, a date |
| `lede`                                         | a lede that is not the first paragraph after the `h1`                        |
| `meta`, `muted`, `small`                       | provenance, a method note, a footnote                                        |
| `callout`, plus `ok` / `warn` / `bad`          | the one box that must not be missed — the answer, a risk, a broken thing     |
| `stats` holding `stat`s of `k`, `v`, `d` spans | a row of headline numbers: label, the figure, one line of context            |
| `cards` holding `card`s                        | options or findings side by side, wrapping to one column on a phone          |
| `tag`, `pill`                                  | a status chip inline in prose or a table cell                                |

```html
<p class="eyebrow">Investigation · 1 Jan 2001</p>
<h1>Event-loop delay: still a problem?</h1>
<p><strong>Not the way it used to be.</strong> …</p>
<div class="stats">
  <div class="stat"><span class="k">Blocks over 20 s</span><span class="v">0</span><span class="d">was 96</span></div>
</div>
<div class="callout warn"><p>New instances still block for 30 to 50 s while they boot.</p></div>
```

## When to write your own stylesheet instead

When the page needs a layout the vocabulary above does not give — a timeline, a diagram built in HTML, a
dense comparison grid. Then design the whole page, the way an artifact would be designed: the house design
steps aside completely, so a half-written stylesheet gets a half-designed page. Keep the measure ruling (a
column near 88% of the window, never a skinny one), and give every web font a system fallback in its stack —
the fleet briefing's own sheet (`src/outbound/briefing/chrome.ts`) is the worked example.

Either way, prove the render before the owner opens it: [render-ladder.md](render-ladder.md).
