# When the voice fails at something it tried, the console window says so

A child of [the voice flow](../voice-flow.md). Five refused `open_card`s with nothing on the owner's screen saying so
is the case this closes: a failure gets an error toast inside the desktop app's own window, never drawn over another
app.

**What is a failure.** One pure classifier (`voiceFailureNoticeOf`, `site/lib/voiceFailureToast.ts`) decides: **a
tool call** that came back refused, or whose `partialFailures` name a part that did not run (an `open_card` whose
panel opened but whose page was refused, say), on its FINAL outcome. An answer the plan call never took is a failure
even when the tool ran (`toolFailureNotice`, `site/components/voice/failureNotice.ts`). A tool that finishes after the
call ended raises only its own failure: an answer with no call left to take it was dropped by the hang-up, which the owner
did, not failed.

**A relay is never a failure the owner is shown**, because the owner has no need to hear about relay failures. Every
final stretch of the owner's wakes the chair to read the call file itself
([every word reaches the chair](voice-context-and-calls.md#every-word-the-owner-speaks-reaches-the-chair)), so a relay
refused, unknown, kept off the chat or shut by the gate loses no word of the owner's. Neither the voice nor the screen says
so unasked: the outcome is journalled on the relay's call line, its turn file and `talk log`, and drawn only in the
session details tray's folded relay record, which the owner opens (`site/components/voice/VoiceSession.tsx`).

**The transport is overlay → main → the console's active tab.** The voice window sends `slopweaver:voice-failure`;
main takes it only from that window (`parseVoiceFailureNotice`, `desktop/src/desktopBridge.ts`) and forwards it to
the console window's active tab when the console is open, shown and not minimized. Otherwise it is dropped: the
toast never raises the window and is never queued for later, and the call's activity record keeps the line either
way. A shell built before this degrades by name, a refused `failure notice` line in that record.

**Where it sits, and why** (`site/components/console/VoiceFailureToasts.tsx`): the top middle of the console,
under the tab strip, where the sharing badge already sits. Bottom left is the sidebar's foot. Not beside the orb,
because the orb floats over every app and a toast there would be drawn over them. One line shows; the detail sits
under "Details" (rule 7). At most three show, the rest wait their turn; each clears itself 8 seconds after it
reaches the screen unless hovered, focused or expanded, and the × dismisses one.

**Every failure is its own toast**, a fresh one for each occurrence, because a toast that fires while the owner is not
looking would otherwise never be seen again. Five refused openings are five toasts, never one counting ×5, so a failure the owner missed while away is shown again the
next time it happens rather than folded into a count the owner never saw.

**A card that did not open offers "Open in new tab"**: one toast per error, each with a button that deep-links to the
queue card that failed to open, opening it as a new tab in the desktop app, never the owner's browser, since queue
cards and briefings do not belong in the browser. Nothing opens by itself; the owner ruled that out. The notice carries the resolved card's own key (`VoicePartialFailure.cardKey`, set by
`refusedOpenings` in `site/components/voice/openCardRun.ts`), never the model's argument. A refused tool and an
`open_card` whose key matched no card carry none and show no button. The button sends only that key over
`slopweaver:open-queue-card-in-new-tab`. Main takes it only from the console window and builds the path itself
(`queueCardTabPath`, `desktop/src/desktopBridge.ts`): `/queue?open=<key>`, or `/alignment` for an act. It then
opens that path as a new tab in front, beside the one the owner is on. No page can hand main a path of its own. A console and shell from different builds can disagree on this
wire, so restart both after a pull.
