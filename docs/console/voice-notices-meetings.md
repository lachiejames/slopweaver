# The voice takes the owner's word on a meeting the owner has had or is skipping

A child of [the voice flow](../voice-flow.md#2--what-the-voice-reads); it narrows
[the meeting heads-up](../../site/content/console/call-widget.mdx) inside
[voice-boundary](../security/voice-boundary.md).

The owner, after the voice told the owner to join a meeting the owner had already said was done, in the owner's
words: assume that the owner is going to all meetings unless the owner has said otherwise, and in this case, the owner
explicitly... said otherwise, so- but- but... it didn't take effect. That's the bug.

**The default is that the owner attends.** Every meeting the server reads with `talk meeting-due` is announced and gets
its join pill, as before. Only a meeting the owner ruled out on this provider's life is left out, and nothing else
changes it.

**The owner's word is a page preference, bound to the owner's words.** When the owner's final words say the owner
already had a meeting or will not go to it, the thinking model reads the owner's calendar first, every time — `calendar list --json`, the same `primary` calendar
`talk meeting-due` reads — and calls `meeting_skip` (`src/talk/meetingSkipToolSchemas.ts`) with each meeting's exact
`calendarId`, event `id` and title off that read. `runMeetingSkip` (`site/components/voice/meetingSkipRun.ts`) refuses
before the owner has said anything final on the call and refuses a meeting without both ids, then stamps every meeting in the
call with the one instant the page received it. A write only ever adds: said again, the new instant sits beside the
earlier one rather than replacing it, since a later stamp could narrow its reach, and no skip is ever dropped or
evicted, so a call that would take the page past 64 is refused instead. Like
`focus_set`, it is a `preference`: it sets what the page announces for the owner and holds the skips nowhere else, so
`relay_steer` stays the relay writer. Its only durable trace is the `skipped: <titles>` line the call transcript keeps
for every tool, which no meeting check reads.

**The key is the calendar instance, never the title.** A skip covers a notice only when its `calendarId` and `eventId`
both match and the meeting starts within `MEETING_SKIP_HORIZON_MS` (12 hours, edges included) of the instant the owner
said it (`skipCovers`, `site/lib/meetingDue.ts`). Two meetings can share a title inside a day, and the spoken title is cut
to 80 characters, so a title would skip the wrong one. The horizon guards against a reused provider id, not identity,
and it is judged against the meeting's start as each read prints it: a meeting moved more than 12 hours from the owner's
word is announced again, on purpose, since what the owner ruled out was the meeting as it then stood and the default
is that the owner goes.

**Both candidate lists are filtered.** The page posts `{ shown, skipped }` to `/api/talk/call/[id]/meeting-due` with
every 30-second ask (`useMeetingWatch`); the route refuses a malformed list with a 400 before it reads the calendar, and reads an absent one, from a tab
opened before skips existed, as none.
Its body cap, `MEETING_DUE_BODY_MAX`, is derived from every list's and string's own cap, so a page holding every skip
it may is never refused for size, which would hide every meeting rather than only the skipped ones.
`meetingDueCandidates` (`site/lib/meetingDueCandidates.ts`) drops skipped meetings from this read AND from the
process ledger's claims, since a claim kept from an earlier lost answer would otherwise still raise the heads-up. The
ledger itself keeps the raw read: a skip is one page's word, and another page's claim is not this page's to drop.

**A pill already up goes at once.** The skip's write takes the pill down when the owner's word covers it
(`pillAfterSkips`), without waiting for the next poll, and the watch rechecks the skips before it shows an answer that
was in flight while the owner spoke, logging `<title>: skipped on the owner's word, no join link` instead (`watchMeetings`, `site/lib/meetingDueWatch.ts`).

**What it does not do.** The skips live for the provider's life, like the shown ids and the focus plan, so a plan-call
rollover or a reconnect carries them, and a console reload or a provider remount loses them: the next due meeting the
owner ruled out is announced again. And one race is left open on purpose: an ask posted before the owner's word is decided on the
skips it carried, so a line it hands the voice is still spoken, though its pill never goes up — the route reads the
calendar for seconds first, so that window is the ask's whole round trip. A line once handed cannot be taken back at
all: `thread/realtime/appendSpeech` has no retraction. A pill already up is refreshed by its notice id, which carries
the meeting's start, so a meeting moved after its pill went up keeps that pill until it ends, as it did before skips
existed; a skip covering its new time stops any heads-up for it, not that old pill. Closing the reload loss needs the skip written durably, which
is a new model-callable writer with its own gate and the owner's word on it; narrowing the race needs the skip held by the
server's call as well as the page.

**What crosses.** The skip's ids and title came off a calendar read the model already made, and are posted only to
this machine's own route. The spoken line is unchanged, so nothing new reaches the OpenAI realtime session.
