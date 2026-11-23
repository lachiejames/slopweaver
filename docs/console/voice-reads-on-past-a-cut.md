# A cut read says so, and a whole-read claim over one is held before the voice

The owner's ruling on the read-gap page's fixes: keep fetching the rest when a tool response is cut off, and have each
tool report exactly how much it returned, with an unsupported claim of completeness or a total blocked before it is
spoken, because the owner has often expected a full read that never happened. Reading also stays token-efficient, never a walk top to bottom through verbose folds. The parent rule,
that the voice says only what the record holds, is [the voice holds to the record](voice-holds-to-the-record.md).

## Every tool answer is read for how much it carried, one way

Every tool answer on a plan call passes `PlanCallTools.answer` (`site/lib/talkPlanCallTools.ts`), so that is where
coverage is read, one way for every tool (`readCoverageOf`, `site/lib/readCoverage.ts`). It reads the closed set of
cut markers the shipped tools already print, wherever in the answer they sit:

- **A cut that a call reads on from**, each naming that call:
  - a file or code window's `nextFrom` (`file_read`, `code_read`);
  - a page reading's window, `nextFrom` with the `reading` it was cut from (`read_page`, [below](#a-page-reading-is-read-on-in-windows));
  - a paged record's `page.nextFrom` under its `pointer` (`recall_open`, in code points);
  - a briefing's `read: "partial"` and `rest` (a words-mode `file_read`);
  - a verb answer's `stdout.truncated` with a `spill` (a `file_read` of the spill from the bytes already carried).
- **A cut no tool reads on from**, read at the fields ITS OWN tool sets (`TOOL_CUTS`, `site/lib/toolCuts.ts`) and
  named back as `field: value`, so the model can say it read only part. Examples:
  - `complete: false`, `beyondCap.more`, `recentlyLeftBeyondCap` and the `cut` sentence (`action_items`);
  - `status: incomplete` and `dms.more` (`slack_unread`), never its rows' own `unread` counts, which are its subject;
  - `hitLimitReached`, `scanBudgetExhausted`, `unreadableSkipped`, `undecodableNames`, `hits[].partiallyScanned`
    (`code_find`);
  - `contextOmitted` (`recall_open`: context turns left out to fit, a full-text page still being its whole record);
  - `redactions` and `outlineCut` (`file_read`), `outlineCut` (`browser`, its own outline's budget);
  - `withheld` cards (`action_items`), `activity.appTagsNotListed` (`slack_unread`), `mentionedOmitted` (`origin`);
  - `typed[].cut` (`recent_steers`: the owner's own turn clipped by the supervisor read);
  - a `verb` call's whole JSON stdout at the fields ITS verb sets (`VERB_CHILD_CUTS`, `site/lib/verbChildCuts.ts`), named
    `stdout field: value`; a verb with no entry there reads as whole, so that list is what a child's loss can reach;
  - a Slack read's loss said only in `warnings`, past the standing bot-token caveat;
  - `origin` passages ending in its own `" …"` while the answer says `truncated: false`;
  - a page's `refused` sentence, for any tool;
  - `read_page`'s `truncated` sentence, on a reading the console window cut before it crossed to the voice's window.

The registry is keyed by every `does: "read"` tool the model can call (`site/lib/talkToolsList.ts`), one entry each.
Two pre-mortems found markers a hand-kept table missed, and a third found that reading any field by its NAME misreads
a tool whose subject is a count (`slack_unread`'s unread rows). So `site/__tests__/unit/toolCuts.test.ts` fails when a
read tool has no entry, making a new tool a decision rather than a silent `whole`, and when a probe names a field no
read tool's source declares, so a renamed field fails there rather than reading whole. That check found the
Automations reading's `historyUnread` probed at the wrong level when it first ran. Each entry also says what its tool
PREVIEWS: a fixed shortening with no flag (a 700-character hit window, a one-line row) is no cut by design, since
counting every preview would push verbose reads back into every answer, and the entry names the call that reads the
whole. The value is never paraphrased, since a clause written here would misdescribe a count it does not own. An
answer carrying no marker is `whole`, which is what it already claimed to be.

A cut answer reaches the thinking model with one `READ COVERAGE` line naming each cut, how much came back of how much,
and the exact call that reads on, or that none does. A whole answer goes as it came, costing nothing.

## A cut stands until it is read on from where it stopped

Each cut stands open until the next ask's turn starts (`CoverageHold`, `site/lib/coverageHold.ts`): a Codex turn
starting with no other running, and not one the hold's own send-back started. That is the boundary rather than the
owner's closing transcript, since that `done` often lands after the turn it started has already read, and wiping the
cuts there let the turn's own claim through. A new ask never deletes a cut: each carries the turn that left it, and an
answer is judged against the cuts of every ask its own turn was seen in, another turn's included, and an answer from a
turn never seen against every standing cut. A start cannot say which ask a still-running turn's cut belongs to, since
a sibling's start can land before the reading turn's own, so a cut left by a turn not yet seen ending is carried into
every new ask; only an ended turn's cuts stay behind. So a start notice landing late or early, or a newer ask's turn
starting before a turn's answer arrives, never parts an answer from its own ask's reads. A failed tool
answer is read the same way, since its content still reaches the model. Only the send-back's `turn/start` answer says which turn is its own, so
no turn start resets while one is unanswered; the console keeps that request open for the call's life, because the
wire sends no cancel and a start it stopped waiting for may still run. An answer naming no turn, an error included,
leaves no start safe to read as a new ask (an error can still start the turn), so after one the
cuts hold for the rest of the call. So do they when another turn starts between an answer naming its turn and that
turn starting, since the named turn may never start under that id. A cut with a call closes only for a read that ran (a failed one read nothing on) of the same path or pointer that
**starts at or before where the cut stopped**, so a read that skipped ahead never certifies the part it skipped; one
that is itself cut leaves its own gap in its place. A page window's cut also names its `reading`, and closes only for
a read on naming that same reading, so a fresh `read_page` of the same path after a redraw reads other text and
leaves the cut standing. A redraw's own cut stands beside it rather than folded into it, so reading on one reading
never clears the other's. A cut no tool reads on from stands until the next ask, and only
the claim can go. A refused answer stands as a cut of its own and closes
nothing: a refused read on names the cut's path and `from`, so read as a read it would certify what it never read.

## A page reading is read on in windows

A `read_page` answer past its bound carries one window of the page's serialised reading, never split inside a
character: the largest window whose whole answer, escapes and fields included, fits the bound. A window's `shows`
is text, so every window also carries the whole reading's own cuts (`readingCuts`, a Queue's `drawnMore` say), the
first eight, each held to 200 characters and the rest counted, so a long one never crowds out the window. They
ride before any of the reading's text, as the page's own fields do, so the last window never reads as whole over one,
and a page they and those fields fill gets no window, its cut naming them; the desktop shell's crossing names them in its cut. It comes with `nextFrom` in UTF-8 bytes and `reading`, an id of that exact text (`site/lib/pageReadWindow.ts`).
`read_page` with that `path`, `reading` and `from` reads the next window; the sentence saying so rides in `readOn`,
never `truncated`, which names a cut no call reads on from. A call naming any of the three is a read on, so one
missing a field is refused, never read afresh under an old window's `reading`. It is refused once the page moved, to another
page or the same page redrawn to other text, because a window of the new text would splice two readings into one.
The id names the text, not the draw, so a page redrawn back to byte-identical text is the same reading and reads on. A `from` inside
one character is refused too, since a window from it would open on half that character. Any other `from` inside the
same reading is a read of exact bytes of it: one behind `nextFrom` re-reads, and one past it skips ahead, which by the
hold's rule above closes no cut it skipped. It is also refused
in the desktop shell's voice window, where the console window cut the reading before it crossed: that cut says how many bytes
of the reading it carried and that the rest does not cross (`site/lib/desktopPageReading.ts`). A published page in the
viewer is the exception: only its slug crosses, its words are read in the voice's window at every `read_page`
(`site/lib/publishedPageVoice.ts`), so they read on there, and a republish between two windows changes the reading and
refuses the read on. A page whose reading never reached the voice's window is windowed there, so its stand-in sentence reads on. A path there longer than the
console window's keeps the page's path, title and open card whole: what crossed is cut to the largest start of it
that fits beside them, its cut saying how much of what crossed it carries. A page whose own path, title and open card leave no room for one character
gets no window and no `nextFrom`, and one whose path or title alone passes the bound carries neither, so no answer
passes it.

## A claim over a standing cut is sent back, a bounded number of times

Before a completed answer is held for the voice, its sentences claiming a whole read or a total (`coverageClaimsOf`,
`site/lib/coverageClaims.ts`; a hedge like "only", "so far" or a negation is never one) are judged against those cuts.
A claim over an open cut never reaches the voice: a `held-answer` event of phase `dropped` records it, and a
`turn/start` sends the thread back with the claim quoted and each cut's call, to read on only as far as the claim needs
or answer again saying which part it read.

An answer is judged once, as it completes, against the cuts standing then. A cut a sibling turn leaves after that is
not one the answer could have rested on, so it never recalls an answer already waiting for the voice; it counts against
the next answer instead.

After two sends back in one ask, or a send-back that did not start, the voice is handed `CANDID_ANSWER` instead,
so the hold never leaves the owner in silence. What replaces the claim is in hand before any event goes out, so a
listener that throws cannot leave it with none.

## What it does not stop

A claim worded another way is not seen; the after-speech checks in the parent page still run behind it. Every cut
standing in the ask counts against a claim, related to it or not, so an unrelated cut can send back a sound total, and
a turn starting while another runs keeps the running one's cuts, a new ask keeps those of a turn not yet seen ending,
and so does every start while a send-back stays unanswered, and every start after one answered naming no turn, with an error, or overtaken by another start: the bounded send-back and the candid line
cap that cost, which only ever holds a claim back, never passes one.

The one ordering it passes: the wire carries no ask, so the hold infers one from turn starts. A turn that continues an
ask but starts with nothing running, after every earlier turn of that ask was seen ending, reads as a new ask, and a
claim it makes over an earlier turn's cut that no later read closed is handed on. Gating the boundary on the owner's words was weighed and not taken: the owner's transcript can land after
the turn it set off has started, so it moves the misread boundary rather than removing it. Never letting a cut expire
was weighed too: a stale cut from an earlier ask would send back a sound answer twice and then say the candid line,
which would then be false. The model was still told of that cut, in the `READ COVERAGE` line of the answer that left
it, and the after-speech checks still run.

A record that quotes an old answer's markers reads as cut too. This stops the thinking model's claim, never one the voice adds while paraphrasing, since `thread/realtime/appendSpeech` has no
verbatim channel. Fix 1 of the same ruling, reading the record rather than the page's copy, is
[the Queue tools read the record at the tool](voice-reads-the-record-at-the-tool.md).
