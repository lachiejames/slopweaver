# The voice nudges the owner back to tagged work when the owner strays in work hours

A sibling of [the drift line](voice-notices-drift.md): the same front-window sample, the same spoken-line path, the
same **focus** chime a second before it, inside [voice-boundary](../security/voice-boundary.md).

The owner, on a console call: while the owner is on other work, the voice should remind the owner that the work
carrying the `workstream=iso-certification` tag still has things waiting on the owner. Two
refinements: it is not a force, so the line is an observation plus the thing waiting, never an
instruction; and it names one specific tagged card, never the workstream in the abstract.

**The cadence is the contract.** In work hours — Monday to Friday, 09:00 to 17:00 in the owner's own time zone — once
a stretch away from the tagged work has run `ISO_STRAY_DWELL_MS` (10 minutes) while a tagged card waits on the owner, the
voice says one line. Then silence, and one more only `ISO_STRAY_AGAIN_MS` (60 minutes) after the first if the same
stretch runs on. Never a third, never a card, never a DM. A new stretch's first line also waits out those 60 minutes
after the last one, so stepping onto the tagged work and off again cannot buy a line every few minutes. The pure fold is `site/lib/isoStrayWatch.ts`;
`site/__tests__/unit/isoStrayWatch.test.ts` is the proof the owner asked for. The fold's state is kept in this browser's
`localStorage` (`site/lib/isoStrayStore.ts`), pending nudge and its id included, so a reload mid-stretch carries the
cadence on rather than waking an idle watch that would owe a fresh first line. A pending nudge is kept only while its
card still waits under the same key and subject; otherwise it is spent unsaid, never re-minted for the next card,
because a retried post may already have been said and the ceiling outranks the floor. A kept id not shaped like the page's
own `crypto.randomUUID()` reads as no state at all, and so does one whose fields the fold could not have written
together by now: a time still to come, a count the stretch's own dwell and hour could not have bought, or a pending
nudge not yet owed. The test that every state a scripted day reaches reads back unchanged keeps that check from
dropping a real one. A browser that refuses the write loses
only that carry-over, said once in the call's log; the sampler, drift included, runs on. The server holds the hour
too: `TalkNoticeLedger` answers any nudge claimed under an hour after the last as already said, whatever its id, so
a page that lost its watch still cannot buy a line early. It can buy a late one: the server holds the hour, not the
stretch, so a reload in a browser that refuses storage can add a third line an hour after the second. The desktop shell
runs on Electron's default persistent session (no partition is set in `desktop/`), and the log line names the case.

**Being on the tagged work is judged deterministically, never by a model.** Slopweaver in front is judged by its
open card alone, never by its title's words. One sample is:

- **`iso`** — a window title holding one of `ISO_TITLE_KEYWORDS` (`iso`, `iso27001`, `27001`, `vanta`, `isms`) as a
  whole phrase, or Slopweaver in front with a tagged card open;
- **`off`** — any other window whose title macOS gave, or Slopweaver with another card open;
- **`unknown`** — no sample, a withheld title, Slopweaver with no card open, or a card whose tags did not read whole.

A stretch starts on its first `off` sample, carries across `unknown` ones, and ends on an `iso` sample, outside work
hours, or `ISO_STRAY_GAP_MS` (5 minutes) with no `off` sample.

**A tagged card is one tagged `workstream=iso-certification`** ([tags](../tags.md)), read whole, among the Queue's
live rows in its one ranking (`site/lib/isoQueueItems.ts`) — never a subject that only mentions the standard, and
never a check-in. The line names the first. A board row joins with
`slopweaver handover tag <slug> workstream=iso-certification --why "<why>"`.

**The line is the server's.** The page (`site/components/voice/useFrontWindowNotices.ts`, one sampler shared with the
drift watch, sampling while a call is live) posts `{ noticeId, item: { key, subject }, minutes, again }` to
`/api/talk/call/[id]/iso-nudge`, read by `isoNudgeNoticeOf` (`site/lib/isoNudgeNotice.ts`), which refuses any surplus
field rather than dropping it. A pass that posts a drift line posts no nudge, a nudge is sent beside the
pass after its next poll is armed, and drift folds only a read begun while a plan was held, so drift's schedule is
untouched. The page chooses the card, the same trust the drift route gives the page's plan label.
`WindowNoticeLines.announceIsoNudge` (`site/lib/talkPlanWindowNotices.ts`) has the voice SPEAK the fixed
`isoNudgeSpeech` — _"Just so you know, you've been on other things for 12 minutes, and the ISO card "Quarterly access
review" is still waiting on you."_ The subject keeps only letters, digits and plain punctuation, every quotation mark
read as an apostrophe, so the card's name cannot close its quote and speak words outside it. It waits for a clear floor and shares the drift line's busy flag, so the two
never overlap; the page posts again while it is owed, every `ISO_STRAY_RETRY_MS` (4 s) with no
plan held and on the next poll under one, and a nudge is said once per
notice across every call of this server (`TalkNoticeLedger`), claimed before the write.

**What crosses.** The one card's subject and the minutes, inside the spoken line, reach the OpenAI realtime session,
the class `action_items` already sends. No window title, no application name and no other row leaves the page.

**`focus_quiet` does not quiet it.** That wave-off belongs to the drift plan the owner stated; the nudge's own cadence
is the bound the owner asked for.
