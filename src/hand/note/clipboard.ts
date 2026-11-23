/*
 * THE NOTE'S CLIPBOARD — how a floating note copies its literal and knows, each poll, whether the owner's clipboard
 * still holds it — kept as the JS SOURCE `./panel.ts` embeds, the same way `./fitRows.ts` holds the layout
 * arithmetic and `./lifecycle.ts` the close rules. Needs `nsstr` and `STEP`.
 */

/**
 * The emitted program's pasteboard state, `copyText`/`copyLiteral`, `clipboardHolds`/`clipboardStillHoldsLiteral` and
 * `refreshClipboardLabel` — the `Text` pair serving a checklist line's command (`./checklist.ts`) by the same rule.
 */
export const CLIPBOARD_JS = `
// The pasteboard is a SHARED, SINGLE-SLOT resource, so a claim written once at launch decays the instant
// anything else touches it. What the caption asserts is therefore RE-DERIVED each poll, from two things:
// an ownership token, and — when that token still matches — the pasteboard string itself. The token alone
// is never the answer; see clipboardStillHoldsLiteral below for the overwrite that is why.
//
// The token is the count clearContents RETURNS — the count of the ownership WE took — never a count read
// back afterwards. Reading it afterwards is a race Codex caught before this shipped: write A here, another
// process writes B, read B's count, and every later poll matches B while claiming A is on the owner's clipboard,
// permanently and silently. setStringForType returns false when ownership has already moved on, so the
// token is retained only on a write that succeeded. Both sides are stringified because a JXA-bridged
// NSInteger does not compare === across two reads.
var board = $.NSPasteboard.generalPasteboard;
var copiedAtChangeCount = '';

function copyText(text) {
  copiedAtChangeCount = '';
  var owned = String(board.clearContents);
  if (board.setStringForType(nsstr(text), $.NSPasteboardTypeString) === true) {
    copiedAtChangeCount = owned;
  }
}

function copyLiteral() { copyText(STEP.literal); }

// The count is a PRE-FILTER, never the answer. Measured on this machine: a second process
// calling setStringForType with no clearContents replaces the string IN PLACE and leaves changeCount where
// it was, so a token that still matches proves nothing about what the owner would paste. Reproduce it under
// osascript -l JavaScript: clear, write A, write B with no clear, and read the count back unchanged.
// So a mismatch answers "moved on" for free, and a match is CONFIRMED against the string itself. That
// keeps the string read off the common path where some other process is churning the pasteboard; it does
// NOT promise the payload is ours, because the in-place overwrite above is exactly a foreign payload under
// an unchanged count — which is why the string, not the count, decides.
//
// Two residues are kept rather than chased. Another process that takes ownership and copies the SAME text
// reads as "moved on" though pasting would work, and its advice (press Copy) is still correct. And a write
// landing between this read and the caption's own setStringValue leaves the caption one poll wrong, the
// same instruction-level window any polled view of a shared resource has; AppKit posts no notification on
// changeCount, so closing it would take a tighter spin or a second process, both costing more than it.
function clipboardHolds(text) {
  if (copiedAtChangeCount.length === 0) { return false; }
  if (String(board.changeCount) !== copiedAtChangeCount) { return false; }
  var current = board.stringForType($.NSPasteboardTypeString);
  if (current.isNil()) { return false; }
  return String(current.js) === text;
}

function clipboardStillHoldsLiteral() { return clipboardHolds(STEP.literal); }

var CLIPBOARD_HOLDS = 'on your clipboard \\u00b7 click the command to copy it again';
var CLIPBOARD_MOVED_ON = 'your clipboard has moved on \\u00b7 click the command to copy it';
// Both clipped captions are SHORTER than CLIPBOARD_MOVED_ON, which is what the row is measured on, so
// swapping to one of them can never need a line the layout did not reserve.
var CLIPPED_HOLDS = 'shown in part \\u00b7 all of it is on your clipboard';
var CLIPPED_MOVED_ON = 'shown in part \\u00b7 click the command to copy all of it';
// Set by the program's fit once its rows are laid out, when the literal's row came out shorter than its text.
var literalClipped = false;
// The caption row under the literal, built by the program with its rows; null on a step with nothing to paste.
var clipboardLabel = null;

// The caption under the literal, re-derived each poll. It reads literalClipped and clipboardLabel, which the
// program sets once its rows are laid out, before either of these is called.
function clipboardCaption() {
  var holds = clipboardStillHoldsLiteral();
  if (literalClipped && holds) { return CLIPPED_HOLDS; }
  if (literalClipped) { return CLIPPED_MOVED_ON; }
  if (holds) { return CLIPBOARD_HOLDS; }
  return CLIPBOARD_MOVED_ON;
}

function refreshClipboardLabel() {
  if (clipboardLabel === null) { return; }
  var text = clipboardCaption();
  if (String(clipboardLabel.stringValue) !== text) { clipboardLabel.setStringValue(nsstr(text)); }
}

// A literal goes on the owner's clipboard the moment the note launches; a checklist copies nothing until they click a line.
if (STEP.literal.length > 0) { copyLiteral(); }
`;
