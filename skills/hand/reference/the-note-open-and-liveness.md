# Open, and notes that stack — the primary button, one note per step, and the cascade

A page opens from the note's primary button, never from a command to paste, and a step never shows as two
notifications. Both halves live here; [the note](the-note.md) is the rest of how it is drawn.

## Open is the primary button, and it is filled by a layer

A step whose `url` is set draws **Open** first in the band, in the accent colour, and a link never reaches
the note as a command to paste: `hand post` refuses a `--literal` that is only a link, or any `open`/`xdg-open` naming one (flags and all), and
`--url` takes a published page by its viewer address: a pasted `open file:///…/index.html` is never the
way, since one of the primary buttons should be opening it.

**AppKit's own "primary" draws grey here.** Measured on this panel with `screencapture -l`: a
Return key equivalent and a `bezelColor` each left Open exactly as grey as the band's other buttons, because AppKit
desaturates a bezel in any window that is not key, and this one never is. So Open is borderless, and its
own layer carries the accent fill and the corner radius; a layer's fill is drawn whatever the key state.
Reproduce the grey half by putting `setBezelColor($.NSColor.controlAccentColor)` back and capturing the
window by its number:

```bash
slopweaver hand post --home "$H" --standalone --blocks --id p --what "Read the page" --url "https://example.org/" --unblocks x --witness y
screencapture -x -o -l <kCGWindowNumber of the osascript window> /tmp/w.png
```

## A console link opens in the desktop app, in a new tab

Clicking a floating note deep-links into the desktop app, never into Chrome, and a new tab inside the desktop app
is the right landing. Every link a note opens (Open, a checklist line's page, a detail's act, a quote) goes
through one emitted `openLink` (`src/hand/note/desktopLink.ts`). A link on the console — its origin, or any loopback
spelling of it on the same port — is opened as `slopweaver://open?path=<path>` when LaunchServices resolves that
scheme to the desktop app's own bundle (`ai.slopweaver.desktop`), which claims it (`desktop/src/deepLink.ts`) and
opens it as a new tab in front — bar a Queue address, which goes to the Queue's one pinned tab and never a second
(`deepLinkTarget`). With no handler, another app's, or a link off the console, the link
itself opens in the owner's browser exactly as before.

## One note per step — the per-step half

Two copies of one note once stood at once: `hand post` raised it and `hand push` raised it again
for the same arrival, twelve seconds later. `src/hand/note/liveness.ts` is the protocol; who writes what is
the design:

- **The raiser alone writes `live/<id>.want`**, the newest raise's token, before it launches. A panel reads
  it before it touches the clipboard or draws, and every poll after: a different token closes it with no
  marker, so the newest RAISE wins, not whichever process polled first.
- **A panel alone writes `live/<id>.<token>.beat`**, carrying its build, about once a second. `hand post`
  and `hand push` KEEP a note whose beat is fresh on this build, or that is still starting (wanted within the
  startup window with no beat yet); `hand show` always REPLACES. A beat on an OLDER build never keeps: a
  raise that keeps writes no build, so keeping one would pin a stale program on screen. A note that CLOSES
  overwrites its beat with `closed` rather than deleting it: with no beat, a note put down seconds
  after its raise reads exactly like one still starting, and the next `hand post` would say "already
  floating" over an empty screen.
- **Every raise gets its own bundle.** With one shared `note.app`, two raises close together would rewrite the
  program before either launched process read it, so both would draw the same step under the same token. No
  panel re-writes a shared token as its heartbeat, which would be a read-then-write race.

Measured on the owner's machine, isolated home: post then push drew one panel and left one bundle, and
two `hand show`s fired concurrently left one panel, the wanted token's.

## Notes stack, across every step

A new note
never replaces or drops one still up. Each is its own draggable window, and each new one cascades a slight offset
from the last so every title stays readable. A note leaves the screen only on **Done**, **Not now…**, a retraction,
or its row settling — never because another step's note arrived.

- **Each raise reserves a cascade slot**, `live/<token>.slot` holding `<id> <slot> <level>`, under a `mkdir` lock
  (`live/slot.lock`, stale after ten seconds, released only by the raise that holds it) so two raises at once never
  take the same one (`src/hand/note/slots.ts`). The reservation is read back once written and moves if another
  step's live one took that slot first, which covers a raise frozen past the lock's ten seconds. A slot is held while its note is unclosed and its panel's process lives, recorded
  as `<id>.<token>.beat.pid` as the panel's first act, because a held button stalls the beat for as long as the owner
  holds it; before that, inside the startup window, so a panel slower than that to start at all can lose its
  place. A raise that failed before calling `open` frees its slot at once; one whose launch failed holds it through
  the startup window too, since its launcher may have reported failure for a panel still starting.
- **A new note takes the slot past the highest live one, never a gap under a live note.** The newest window is in
  front, so a note filling a gap would cover the title of the note one slot below it. A replaced note comes up where
  the old one stood while that is the top of the stack, and at the top otherwise; once every note is gone the stack
  starts again at slot 0.
- **The slot is the note's place**: `cascadeOrigin` (`src/hand/note/cascade.ts`) steps each slot 24pt left and
  64pt down from the top right corner, wrapping into a new column when the next would leave the screen. Every note
  counts that grid off the display and one nominal 400pt height, never its own, so two notes of different heights
  agree on every slot's place; a note taller than the room below its place is lifted to keep its buttons on
  screen. The panel is movable by its background, so the owner can drag any of them away.
- **A level decides which floats in front, and each level is its own cascade.** Every hand step and monitor notice
  floats at `NSFloatingWindowLevel`, the newest in front; the `meeting-prep` notice one above, so the meeting the owner is
  about to walk into is never under another note. Since it stays in front of every later note, it cascades from
  the top LEFT, down and right, in its own slots (`<id> <slot> <level>` in its reservation), and never sits over an
  ordinary note's title; the two meet only on a screen too narrow for both first columns side by side.
- **Nothing a raise does closes another step's note.** `hand post`, `hand push`, `hand wake` and a fired monitor
  KEEP their own step's note if it is up and otherwise draw a new one; `hand show` always draws a fresh one of its
  step. The only cross-note close is inside one step: a note closes with no marker once a newer raise of its OWN
  step has drawn, its first beat written only after its window is up, which is how `hand show` and a newer program build replace it.
- **A raise that fails anywhere leaves `live/<token>.failed`** and deletes nothing: a shared want read then removed
  could take a newer raise's with it. Every reader skips a failed token, so a raise that never drew neither holds
  its slot nor keeps the next raise of its step back.
- **A note on an older build is replaced, not kept.** A beat carrying another build never keeps, so the next raise
  of that step launches the current program, and the old note closes once the new one has drawn.

`src/__tests__/unit/hand/lifecycle.test.ts` runs the note's own emitted lifecycle over an in-memory file table
for each of these orders, not a grep of its source. The residue: two raises of one step inside one launch can
both draw, and the one not wanted closes on its next poll — a quarter second, or as long as the owner is dragging it or
holding one of its buttons, since an AppKit tracking session blocks that loop. A tombstone means the launch was
REPORTED failed, and drawn proof outranks it: a launcher that times out after its panel drew still replaces the
older note of its step. A note reads every newer raise of its step, not only the wanted one, since a raise token
sorts by when it was minted (`raiseToken`, `src/hand/note/liveness.ts`): a second raise that drew still closes
the first when a third then takes the want file and fails. A newer raise whose panel dies before drawing leaves
no tombstone, so the older note of its step stays up, and its slot reads held for the startup window.
