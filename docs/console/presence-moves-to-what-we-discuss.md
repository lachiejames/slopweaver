# The presence moves to what we discuss — a design note, not built

A child of [the voice flow](../voice-flow.md); the boundary it would stay inside is
[voice-boundary](../security/voice-boundary.md). **Nothing here is built.** It is the questions the owner's idea raises,
written down so the build starts from them rather than from a guess.

The owner's long arc, once the orb sat level with the Dock: speaking to the fleet feels natural, its presence clearly
shown but unconstrained. It generally rests around the bottom right, and when the conversation is about something on
the screen it can move up to that thing.

## What already exists to stand on

- **A box for "the thing"**. `focus_screen` already lifts one region of the owner's screen and dims the rest, on the owner's ask
  (`site/lib/screenFocus.ts`). It turns the voice's box in a still of the owner's display into a rect in the overlay's
  own pixels, so the place the orb would move to is already computed.
- **A flight**. The orb already flies between the corner and the stage, eased and never jumping
  (`site/lib/orbFlight.ts`). A flight to a rect on the owner's screen is the same motion to a different target.
- **A click-through overlay**. The desktop overlay hit-tests only what is pressable (`desktop/src/preload.ts`), so
  an orb resting anywhere takes only its own clicks.
- **A home**. The rest position level with the Dock, out of the way of the owner's applications, yet easy to reach.

## The questions

1. **When does it move?** `focus_screen` lifts only when the owner asks to be shown, because lifting unasked gets annoying
   fast. Does the orb move on the same gate, on any mention of something on screen, or only while the voice is
   pointing at it? That ruling argues for the owner's ask, and the long arc above argues for more.
2. **Where beside the thing?** On it covers what the owner is reading. Beside it needs a side: the side with the most room,
   or always the side nearest home. And what happens when the thing fills the screen?
3. **How does it get home?** On the owner's next turn, as the lift drops, after a quiet spell, or only when the talk moves
   on? A presence that wanders and never returns becomes one more thing to find.
4. **Which screen?** The still is one display. With two, does the orb cross to the other display, or wait at the edge
   of its own?
5. **What does it look like on the way?** A flight across the whole screen is a much longer path than corner to stage.
   Does the orb's presence stream along it, or fade out and gather where it lands? This is where the presences
   (`site/lib/orbPresence.ts`) could earn their keep.
6. **Under reduced motion?** Probably a fade at home and a fade at the thing, never a flight.
7. **Does it ever move without a still?** The rect comes from a picture taken after the owner's latest turn began. If it
   moves on talk alone, the voice is guessing where things are, and a wrong guess is worse than staying home.
8. **What does the browser do?** The browser draws the orb inside one page and cannot see the rest of the owner's screen.
   The idea may be desktop-only, like the native look at the owner's screen.

## What it does not change

No new egress and no new access. It would read only the still `focus_screen` already reads, under the same gate. The
boundary in [voice-boundary](../security/voice-boundary.md) holds as written, unless question 1 lands on "without the owner's
ask". That widens when the voice looks at the owner's screen, so it is the owner's decision, not a build detail.
