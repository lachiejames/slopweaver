# Where the voice's window sits, and at what level

The voice overlay is one transparent window (`overlayWindow.ts`). This page is where it sits on the screen, how
tall it stands among other windows, and how the call's edge glow reaches the screen's real edge without the window
covering it. The overlay's states and focus rules are in the [desktop README](../README.md#what-it-does).

## The corner, and the whole display only for what spans it

The window covers the WHOLE primary display, menu bar and Dock included, only while what it draws spans it — the
stage, a screen focus's dim, the orb landing from the stage. Beside each fit the shell sends the work area's inset
inside the window, and the orb, the panel and the stage's content stay off the menu bar and the Dock by it.

Otherwise — the orb, the open messenger, a call — it keeps to the corner the widget sits in, so ⌘⇧5's window picker
finds the app beneath rather than the voice. The corner is `CORNER_WIDTH` (the Small messenger's 28rem and its
margins), or the width the page reports for the size the owner chose (`reportOverlayWidth`, `overlayReports.ts`),
never narrower. While the owner drags the messenger's edge, the corner takes the work area bar a `MANIPULATION_STRIP`
along its left and keeps the pointer until the drag ends, so the window resizes once at each end of the drag. The
picker selects a window by its layer's bounds, never its pixels' alpha, so a whole-display window was the shot
wherever the owner pointed (`overlayWindow.ts`, `edgeGlow.ts`).

## A dragged orb, and nothing off screen

The owner drags the orb anywhere on the work area, and back down to where it rested. The page keeps its place as the
orb's centre from the work area's right and bottom edges (`site/lib/messengerPlace.ts`) and reports it with the
widget's frame (`reportOverlayPlace`,
`overlayPlace.ts`). At rest the window crops round that frame at the place, held inside the work area and down to the
floor line; while the orb drags the window takes the work area bar the same `MANIPULATION_STRIP`, as an edge drag
does, reaching down to the floor line, so it moves once at each end of the drag. Beside every fit the shell sends the
work area's corner inside the window (`slopweaver:overlay-origin`) and where the orb rests with no place of its own
(`slopweaver:overlay-home`, `overlayHome`): level with a bottom Dock that is below the work area, a negative place,
which a drag may reach and which a drag ending exactly there keeps as no place at all. A page from before the home word
never hears it and keeps its drag inside the work area. The page draws the orb at its place in whichever window holds
it. A drag moves the widget by a transform each animation frame, never a render, and hides everything but the orb
until it lets go, so nothing resizes, flips or re-fits mid-drag. The card opens on the half of the screen with more
room, sized to that room and resized by its edges away from the orb, so neither the orb nor the card is ever off
screen. A place of `null` is the corner, fit exactly as above, and so is a place report the shell cannot read, so no
drag stays held on one; the stage and a screen focus still take the whole display wherever the orb is.

## The edge glow is four strip windows

**The call's edge glow and a share's amber frame are four screen-edge strip windows** main owns
(`edgeGlowShell.ts`), shown only while lit. The glow still runs round the screen's real edge (full-screen, around the menu bar and under the Dock) while the voice's window stays in its corner.
The page reports the glow (`reportOverlayGlow`) and draws it itself only under a shell from before the strips.

The glow lights and goes out in its strips, never by moving the voice's window. A glow that flipped the window with
every turn the voice spoke showed the orb elsewhere on screen each time. A move
that does happen, the corner growing as the messenger opens, is drawn see-through until the page has painted at the
new bounds (`overlayMove.ts`).

## The menu bar's level, under ⌘⇧5

**Every one of these windows sits at the menu bar's own level** (`main-menu`, 24), never above it. ⌘⇧5 dims the
screen in a window at that level, made after the voice's and so ordered over it, and the old `screen-saver` level
drew the messenger undimmed over that veil, out of your reach. The trade: an
open menu-bar menu now draws over the glow.

No window is ever content-protected, so a shot of the orb has the orb in it.

## The floor line

Either way the orb rests on one floor line (`overlayFloorLine`), the floor the shell sends beside the inset:

- **Dock along the bottom**: the orb's centre on the Dock strip's centre at the same X, below every app window
  (the orb sits under the application window, centred with the Dock). The corner runs into the Dock's strip at a level above the Dock's (`CORNER_LEVEL`, the whole
  window's own, so a fit never re-orders it).
- **Dock at the side or hidden**: `TOOLBAR_BAND` (72 points) above the work area's bottom, so an app's own bottom
  bar stays clickable under it (a video call's meeting controls must never sit under the overlay).

A page from before the floor never subscribes to it, and its corner stays on the work area so its orb never drops
as the window turns whole.
