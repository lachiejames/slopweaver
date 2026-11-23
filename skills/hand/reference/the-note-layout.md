# Fitting the note to the screen — why no field carries the buttons off it, and the one case that would

`buildHandStep` caps LENGTH and not LINES, and the button band rides the panel's bottom, so any field can
grow the note until **Done** and **Not now…** are off the display and the owner is back to buttons that do nothing by
a second route. Measured through the real row code, against 982pt of usable height: 2000 `x` characters draw
855pt, a thousand one-character lines draw **10,210pt**, and a hundred-line `unblocks` draws **1,585pt**.

**Shrinking the literal alone is not enough** — Codex's second pre-mortem measured a multiline `where` still
drawing 1,169pt with the literal already at its floor, and a no-literal step skipping the clamp entirely. So
`fitRows` LEVELS: each turn lowers the tallest rows, all of them when they
tie, to a common ceiling, stopping at the next row down or at a row's floor. Levelling rather than stripping
one row keeps a 2000-character command readable when a long `where` is what actually overflowed — stripped,
it sat at its 48pt floor while the `where` kept 813pt. The algorithm is one exported JS SOURCE string in
`src/hand/note/fitRows.ts`, because the program runs in its own process and can import nothing, and
`panel.test.ts` runs that exact string, so the geometry assertions are on the shipped arithmetic —
including r3's own counterexample, where dividing an overflow three ways left the total **2.27e-13pt** over
its budget. Targets are floored to WHOLE points, which makes the bound exact rather than nearly exact and
keeps AppKit off a fractional row.

Never the band, and never the copy: the whole literal is on the pasteboard before any of this runs. The
literal's floor is the highest because it is the one row the owner READS, and its clipping is the one the caption
reports — `shown in part · all of it is on your clipboard`, or `shown in part · click the command to copy
all of it`, both shorter than `CLIPBOARD_MOVED_ON`, the string the row's height is measured on. A clipped
`what`, `where` or `unblocks` row is simply shorter, and the whole step comes back from `slopweaver hand
list --json`, which prints every field and raises no panel. Not `hand show` — that redraws the SAME fitted
note and copies the literal again, so it recovers nothing the note has already clipped.

```bash
H=$(mktemp -d)
slopweaver hand post --home "$H" --standalone --blocks --id big --what "Paste the rotated key" \
  --literal "$(awk 'BEGIN{for(i=0;i<1000;i++) printf "x\n"}')" \
  --where "$(awk 'BEGIN{for(i=0;i<60;i++) printf "w\n"}')" \
  --unblocks "the rotation" --witness "slopweaver hand done big --did x"
pbpaste | wc -c        # => the whole literal, fitted rows or not; the band is on screen
```

## The opened Details region: entries, and a scroll cap

On one char-wrapped monospaced run that broke `HOLDER_GONE` across two lines, cut each reason at 160 characters
and grew the note toward the band, the owner's word is that below the fold reads terribly, and needs proper
formatting and maybe to be scrollable. So each detail line is read into an ENTRY (`detailEntry`, `src/hand/details.ts`): status, name, age and count on a first line, the reason as
word-wrapped prose under it, in one `NSTextView` inside an `NSScrollView`. The fold above it is untouched.

**An entry the owner has to act on carries a button.** A line ending `[hand:<id>]` (`detailActMarker`) is read as owner
`you` with that card as its act: its reason draws at full strength, and under it an **Open its card ›** line in the
link colour, overlaid by a transparent push-on-push-off button at that line's own glyph rect, a subview of the text
view so it scrolls with it. The poll loop opens the card's Queue link (`siblingQueueLink`, `src/hand/consoleLink.ts`:
the note's own `/queue?open=` link with the id swapped and the context dropped); a note with no Queue link draws no
button. The folded row counts them: `▸ Details (5) · 2 need you` (`needYouSuffix`).

The region's height is `detailsRegionHeight` in `src/hand/note/details.ts`'s `DETAILS_FIT_JS`, which
`panel.test.ts` runs: the text's own height, capped at **240pt** and at the room the collapsed note leaves,
never below zero. A longer list scrolls; nothing is cut. It has no floor, the one term that could exceed the
room. The room is taken when the owner OPENS it, on the screen the note is on then, because the note is
movable. A region sized at layout for the main display, then opened on a shorter one, carried the note's top off
that screen. An empty region grows nothing, gap included. Opening grows the panel down, and
`openedOriginY` moves it UP instead once the owner has dragged it low enough that the band would leave the visible frame. Poster side, the line cap is 320 and a fleet-health line
cut past it ends `…`.

Two JXA hazards, measured: a top-level `function run` is the script's entry handler, and the bridge exposes
no `initWithString:attributes:`. And every colour is `labelColor` at an alpha: `secondaryLabelColor` in a
text view drew dark grey on the HUD, blended only in a vibrant `NSTextField`.

**The one case the fit cannot save, stated rather than implied.** Nothing goes below its own floor, so a
display whose visible frame is smaller than the fixed furniture — 20pt of padding, the 52pt band, 20pt more,
plus every row's floor and gap — still overflows, and `fitRows` gives back those floors rather than a
negative height. That boundary is a property of the display, not of the step, and no step shape reaches it
on a Mac's smallest built-in screen. `panel.test.ts` asserts the floors come back under an impossible
budget; it does not assert native button visibility, which is the honest limit of a test that runs in Node.
