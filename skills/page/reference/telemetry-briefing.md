# A telemetry briefing: charts first, stats in a table, every claim linked

The shape for any page that answers "is this metric getting better". It comes from the owner's read of an
event-loop briefing, where the owner had to translate before-and-after counts into meaning personally,
two charts were broken images, nothing in the table was clickable, and the prose carried a raw UTC stamp.

## The order a reader meets it

1. **One sentence of answer**, then the charts. No methodology paragraph: what a number means goes in a
   tooltip on that number, not in prose above it.
2. **The whole history first.** One chart over everything the telemetry holds, with the retention stated
   on it ("Cloud SQL keeps this from 1 Jan 2001"). Shade the windows the next charts zoom into.
3. **The zoomed windows, lined up, on ONE scale.** Same query, same y-axis, one under another, so big lines
   then small lines say "better" before a number is read. A chart that auto-scales to its own peak makes a
   12 s window look as tall as a 72 s one. Pin the scale: in Metrics Explorer, add a formula
   `0 * a + <ceiling>` beside the real one, and say in the caption that the line is only the pin.
4. **A stats table under the charts.** Every number sits in a cell, never in a sentence a chart already
   shows. Each header and each cell carries a `title` that says how it is computed (the query, the rollup,
   the threshold), so hovering answers "what does this count". Put the meaning in the table too: a column
   that says "alerting hours" beats two raw counts the owner has to subtract.
5. **Every claim links to the Datadog view that shows it.** A chart's caption links the Explorer view with
   its `start`/`end` pinned (`&paused=true`); a table cell links its own window. A replay is a link only:
   it opens on customer pages, so no screenshot of one leaves the machine.

## Screenshots the owner would see in Datadog

- **Images live in the page's own directory** (`pages/<slug>/charts/…`) and are linked relatively. The
  console serves the page over http, so a `file://` image never renders there; `page publish` refuses one.
- **Crop to the plot and its axis.** `sips -c <height> <width> --cropOffset <y> <x> in.png --out out.png`
  takes the margins and the Explorer chrome off a `browser shot --raw`.
- **Annotate in HTML, not in pixels**: a band positioned in % over a `position: relative` figure marks a
  window or a deploy, and stays exact when the image scales.
- **Read every shot before using it.** An Explorer link restored from its `#…` hash can come back
  different from the view that made it. Measured on this page: a `timeshift(a, -600)` formula came back as
  a separate query, and the chart drew only the pin line. Datadog's own Explorer time rollup is `avg`, which
  showed an 11 s peak where the `.rollup(max, 300)` query read 72 s.
- **Never `POST /api/v1/graph/snapshot`.** It creates a public snapshot, which is a write. Shoot the
  Explorer with `slopweaver browser shot --raw` instead.

## Time, the way the owner reads it

The owner's zone, words for months, a 12-hour clock: day and month in words, then the hour and minute with am or pm. UTC is for `<code>` and attributes only.
`page publish` refuses an ISO date-time or a `<HH:MM>Z` clock in prose (`src/pages/lint.ts`); a stamp inside
`<code>`, `<pre>` or an attribute is left alone, because there the raw form is the subject.
