# Hiding the voice

A child page of the [desktop README](../README.md): the X on the corner orb that takes the voice's overlay off your
screen while the call runs on, and what brings it back. The state is `shellState.ts`'s `overlayHidden`; the window
effects are `main.ts`'s.

## The X

The call keeps going while the overlay on your screen is gone, and the menu bar brings it back. Hovering the corner orb, or
reaching it from the keyboard, reveals a small X at its top-right. It appears at once and takes the pointer only
while it can be seen, so no press lands on an X still fading in. Under an older shell with no `hideOverlay`, and in
a browser, nothing is drawn.

Pressing it folds the card, reports what is drawn, then asks main to hide (`hideOverlay`, taken only from the
overlay). The preload releases the pointer first, so the window passes clicks through once shown again. Main hides
the window and leaves the call running: the renderer is never throttled, so the call keeps talking.

## What brings it back

While it is hidden the menu bar's voice item reads Show voice, whatever the call is doing. It comes back on:

- Show voice;
- any explicit ask for the voice, a start, expand or corner from the menu bar or the console window;
- the next call starting, which opens on the stage or in the corner as your start switch says.

The call it was hidden in ending leaves it hidden, so the orb never pops back as you hang up. Shown again under a
pointer that has not moved, main tells the page and the resting point is hit-tested, so the orb takes the click.

## The stage never hides

The X goes the moment the view becomes the stage, before the window has grown to cover the desktop. Main refuses
a hide that arrives after the stage has reported itself up. A press reports what is drawn before it asks, so main
never judges it on an older stage report. There is no drag: the orb is always bottom right (a wrong spot is fixed by closing it, not by drag controls).
