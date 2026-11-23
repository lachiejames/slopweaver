# The voice notices a drift from what the owner said they would do

A child of [the voice flow](../voice-flow.md#2--what-the-voice-reads); it speaks the way
[a meeting about to start](../../site/content/console/call-widget.mdx) does, inside
[voice-boundary](../security/voice-boundary.md).

The owner, planning their day with the voice, wants it to interject the way it does when a meeting is about to start:
by the way, you said you would do this, but you are doing that. The owner may wave it off and do what they want;
being notified is still useful.

**The plan is the owner's words, held by the page.** When the owner's words on a call commit to a stretch of work, the
thinking model calls `focus_set` (`src/talk/focusToolSchemas.ts`) with a few-word `plan` in the owner's terms, the
macOS `apps` the work happens in, and title `keywords` that mean the owner is doing it. It is refused before the owner
has said anything final on the call, refuses a browser as an app (a browser holds anything; a title keyword stands
in), and keeps the owner's newest final words beside the label (`runFocusSet`, `site/components/voice/focusRun.ts`). `focus_end` drops it. All three focus
tools are `preference`, like `set_stage_setting`: they set what the page watches and write nothing else. The plan
lives for the provider's life, so a plan-call rollover carries it.

**The signal is names, never a frame.** While a plan is held and a call is up, the voice's page asks the desktop shell
which window is in front every `FRONT_WINDOW_POLL_MS` (15 s) over `slopweaver:front-window`
(`desktop/src/frontWindow.ts`, `frontWindowShell.ts`). Main runs one fixed JXA program through `/usr/bin/osascript`:
`NSWorkspace`'s frontmost application, and the title of its frontmost ordinary window from
`CGWindowListCopyWindowInfo` — no System Events, no Apple event, no Accessibility. macOS withholds that title without
Screen Recording, so it is `null` then. The handler takes only the voice's window and only during a call
(`noCallRefusal`, the same two gates as a look); a locked screen answers a refusal, not a sample. A sample never leaves
the page. The owner's ruling on pictures stands: [no frame is sampled on a timer](voice-sees-the-owners-screen.md).

**The messenger band reads the same names, separately.** While the messenger is open, with or without a call, its band
asks `slopweaver:front-app-band` for the same program's answer on its own clock, `FRONT_APP_BAND_POLL_MS` (2s, while
drift keeps its 15s), and again on each focus change of the voice's window (`desktop/src/frontAppBandShell.ts`,
`site/components/voice/useFrontAppBand.ts`), and draws the application's name and its window's title. With the messenger focused it answers the last external
application sampled, labelled **Last app before messenger**, never as the one in front. Main answers only the voice's window, only while the messenger is
open or a call is up. The title stays on the card: no text the model, a relay or the call's file gets carries it.
The one way it reaches a picture is the look the owner asks for: the card is on their screen, so a frame of the screen
shows the band. That frame also shows the window the band names, its own title bar or tab included.

**The judge is set once, then deterministic.** `site/lib/driftWatch.ts` matches each sample against the plan: on-plan
is Slopweaver itself, a named application that is not a browser, or a title holding a keyword as a whole phrase ("ISO"
in "ISO 27001 controls", never in "isomorphic"). No model sees a sample, so a window that fits says nothing at all.

**One off-plan window past the dwell owes one line.** The same application and title held in front for
`DRIFT_DWELL_MS` (3 minutes) mints a notice id; a new window or an unreadable sample starts the dwell again. The page
posts `{ noticeId, app, plan, minutes }` to `/api/talk/call/[id]/drift` (`useFrontWindowNotices`), bounded by `driftNoticeOf`
(`site/lib/driftNotice.ts`): never a window title or a bundle id. `WindowNoticeLines.announceDrift` has the voice SPEAK the
server's fixed `driftSpeech` — _"By the way, you said you'd do the ISO access review, but you've been in Slack for 4
minutes."_ — through `thread/realtime/appendSpeech`, exactly as a meeting line is spoken. It is a nudge, never a
cut-in: it waits for a clear floor (`floorRefusal`), and the page posts again every `DRIFT_RETRY_MS` (4 s) while the
same window still holds the front. It is said once per notice across every call of this server (`TalkNoticeLedger`,
shared with [the ISO nudge](voice-nudges-iso.md)), claimed before the write. No card, no pill, nothing drawn: it
stays SPOKEN, never visual-only, because the owner spends much of the time away from the computer. Once claimed, the page rings the **focus** chime and the line is written a second later
(`heraldLine`, `site/lib/talkPlanAnnounce.ts`), so the owner hears what kind of line it is before the voice says it — the four
chimes are in [the call widget](../../site/content/console/call-widget.mdx).

**A cooldown, and the owner's wave-off.** After a line, none for `DRIFT_COOLDOWN_MS` (10 minutes); a drift that runs
on is named again after it, with the whole stretch's minutes. When the owner waves it off ("shut up", "I'll do what I want"), the
thinking model calls `focus_quiet`: the window that line named is never named again for this plan, and every line is
quiet for `DRIFT_QUIET_MS` (30 minutes). The plan stays, since being told is the point.

**What crosses.** The plan label and the application's name, inside the spoken line, reach the OpenAI realtime
session, as every word of the call does. Nothing else about a sample leaves the owner's machine.

**Open, for the owner's word.** A semantic judge (a model reading what is on screen) or periodic frames would see more
than names, and each would need the owner's explicit word over the ruling on pictures. Whether a child `osascript` gets the window title
under the app's own Screen Recording grant is proven on a real call, not assumed; without it the watch runs on
application names alone.
