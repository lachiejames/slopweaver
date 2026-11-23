/**
 * THE FLOATING NOTE — the JXA program that draws one hand step above everything the owner is looking at.
 *
 * A floating macOS note, OUTSIDE the browser tab, Raycast-style, carries the one step the owner must do right
 * now. Outside the browser is the load-bearing half — a page in a tab is a thing the owner has to already be
 * looking at, and the whole point is that they are not.
 *
 * ## Why JXA and an `NSPanel`, measured rather than chosen
 *
 * Measured on the owner's own machine, screenshotted over the live cmux window: an `NSPanel` at
 * `NSFloatingWindowLevel` with `NSWindowStyleMaskNonactivatingPanel`, under activation policy `Accessory`
 * and raised with `orderFrontRegardless`, floats above cmux, Chrome and Slack and never takes keyboard
 * focus. Reproduce the whole thing with `slopweaver hand show` and a `screencapture -x`.
 *
 * Nothing else available here has those three properties at once. A `display dialog` is modal and steals the
 * foreground; a notification is transient; a Chrome app window is the browser the owner asked to be outside of.
 *
 * ## The buttons carry NO target and NO action, and that is a MEASURED constraint
 *
 * The obvious spelling is `ObjC.registerSubclass` with `done:`/`later:` methods and `setTarget`/`setAction`.
 * It was written that way first, it works when the file is handed straight to `osascript`, and it **hangs
 * forever** when the same file is launched through the bundle (`./bundle.ts`) — which is the only way this
 * feature ever runs. Measured by sampling the stuck process:
 *
 * ```text
 * ObjC.registerSubclass → +[JSOCClosure staticPointerValueWithType:invocationBlock:]
 *   → ffi_closure_alloc → dlmmap → open_temp_exec_file_dir → mkostemp → openat  (spinning, ~1500 samples)
 * ```
 *
 * Registering a subclass makes libffi mint a WRITABLE-AND-EXECUTABLE temp file for its closure trampolines,
 * and that allocation never completes for the process LaunchServices starts. The clipboard was never
 * written and no window was ever drawn, while the process burned 73% of a core. Reproduce:
 * `slopweaver hand post … && sleep 3 && pbpaste` — the literal is on the pasteboard when this rule is kept
 * and is not when it is broken, because the copy happens after the registration would.
 *
 * So the panel uses `NSButtonTypePushOnPushOff` and READS `button.state` in the loop it already runs. No ObjC
 * closure is ever built, and the button's own state is what "the owner pressed it" means. `POLL_SECONDS` is
 * therefore the note's click latency as well as its marker latency.
 *
 * ## `NSEventMaskAny` made every button dead, and the fix is a literal
 *
 * Reading `button.state` only works if the click ever reaches the button, and for the whole life of the
 * first shipped note it did not. `$.NSEventMaskAny` is `NSUIntegerMax`; the JXA bridge returns it as a
 * double that cannot hold it, and what arrives at the unsigned parameter matches no event at all — so
 * `nextEventMatchingMask…` dequeued **zero** events and a press was never delivered, which read as the later
 * and done buttons doing nothing when pressed. Measured on the owner's own machine
 * by synthesizing a click over Done with `CGEventPost` and logging the dequeue count: **0** events under
 * `NSEventMaskAny`, **5** events and the marker written under a literal mask. The program therefore spells
 * `2^53-1` — the largest SAFE integer — covering bits 0 to 52, which is every `NSEventType` the installed
 * SDK declares (the highest is `NSEventTypeMouseCancelled = 40`).
 *
 * ## The clipboard claim is CHECKED every poll, never asserted once
 *
 * The pasteboard is one shared slot, so "copied to your clipboard" written at launch decays the moment
 * anything else takes it. The panel keeps the `changeCount` that `clearContents`
 * returned for the ownership IT took, retains it only when the write succeeded, and re-reads the
 * pasteboard's count each poll — and then CONFIRMS a match against the string itself, because a second
 * process writing with no `clearContents` replaces the contents in place and leaves the count where it was.
 * Review caught both halves: taking the token from a READ-BACK adopts whatever
 * process won the race and then claims its clipboard forever, and trusting the count alone believes an
 * in-place overwrite. The line is true as of the last poll rather than this instant — AppKit offers no
 * notification on `changeCount` — and that bounded staleness is the residue kept on purpose.
 *
 * Either way **clicking the command copies it again**, through a transparent button laid over the literal,
 * because a selectable `NSTextField` did not serve that click in this configuration (see the comment at
 * `literalOverlay`) and the never-steals-focus property is worth more than chasing it.
 *
 * ## The injection boundary is ONE `JSON.stringify`, and that is the point
 *
 * A step carries a literal the owner is about to paste — a key, a command, a token — and that string is arbitrary
 * bytes chosen by whatever recorded the step. The program below is a CONSTANT: the only thing composed per
 * step is a single `const STEP = <json>;` line, so nothing a step says is ever concatenated into syntax.
 * `src/__tests__/unit/hand/panel.test.ts` asserts the emitted line exactly, with a literal carrying a quote,
 * a newline and a `});`.
 *
 * ## It closes itself
 *
 * The panel polls its own marker directory and exits when a marker for its step appears; **Done** and each
 * snooze behind **Not now…** write that marker themselves. A note still floating over a step the owner already did is how this
 * becomes furniture, so closing is the panel's own job rather than something a later verb remembers.
 *
 * ## One note per step, and the artifact behind its own button
 *
 * Telling the owner to copy `open file:///…/index.html` into a terminal is a detour, and two copies of the
 * same note at once is clutter. A step's `url` is drawn as **Open**, first in the band
 * and in the accent colour, and `../step.ts` refuses a literal that only opens a link. And each raise
 * writes its token as the step's wanted one: a newer raise of the same step closes this note once it has
 * drawn, and `./raise.ts` reads this note's own beat to keep it rather than draw a second. `./liveness.ts`
 * is the protocol.
 *
 * ## Notes of different steps stack, cascaded
 *
 * The owner can have multiple floating notes on screen, stacked on top of each other and draggable. Each note is its own process and window
 * (`open -n`, `./raise.ts`), dragged by its background, and drawn at the slot its raise reserved: slot 0 top
 * right, each later one a step down and left so every older note's eyebrow and first line show above it
 * (`./cascade.ts`). The newest is ordered front within its window level; a meeting's prep note draws one level
 * up, in its own cascade from the top-left ({@link NoteLevel}), so a later note never buries it.
 *
 * ## While rapid triage is on, every note carries Pause timer and Triage off
 *
 * Both sit top right on the eyebrow's line and exist only while the desktop shell's triage
 * state is fresh and on; a press is one file the shell hands the voice's page (`./triage.ts`, `./triagePaths.ts`).
 *
 * ## A NOTE MAY NOT OUTLIVE THE PROGRAM THAT DREW IT
 *
 * The bundle's launcher hands this file to `osascript`, which reads it ONCE. So a note is frozen at the
 * code of its own raise, for as long as it stays up — and a fix that lands afterwards cannot reach it.
 * That is not a theory: it was met in use. MEASURED on the owner's own machine, a note screenshotted and
 * called dead was running a ten-hour-old program, started two hours fifty-two minutes before the fix for its dead
 * buttons landed, so the fix correctly appeared not to have landed. Reproduce it with `ps -o lstart= -p "$(pgrep -f Resources/panel.js)"`
 * against `git log -1 --format=%cI <the panel commit>`.
 *
 * So the program carries {@link handNotePanelBuild} — a digest of the CONSTANT half of itself — in its beat,
 * and a `keep` raise of its step that reads a different build draws the current program instead of keeping
 * it; the old note closes, with no marker, once the new one has drawn. **The digest covers `PROGRAM` and never
 * `STEP`**: a build that varied with the step would read every note as stale on every raise.
 *
 * The residue, stated rather than discovered: a stale note whose step is never raised again stays stale —
 * a raise of ANOTHER step never touches it, because notes stack. `hand show <id>` redraws it, and the Fleet
 * Briefing carries every open step's literal as a block the owner can copy whether or not any window is behaving
 * (`../../briefing/handSteps.ts`).
 *
 * Pure: a step in, a program out. No I/O, no clock.
 */
import { createHash } from "node:crypto";

import { safeJsonStringify } from "../../lib/safeJson.js";
import type { KindAnswerOffer } from "../kindAnswers.js";
import type { HandStep } from "../step.js";
import { BAND_JS, KIND_ANSWERS_JS, SNOOZE_JS } from "./band.js";
import { CASCADE_JS } from "./cascade.js";
import { CHECKLIST_JS, panelChecklist } from "./checklist.js";
import { CLIPBOARD_JS } from "./clipboard.js";
import { desktopLinksFor, OPEN_LINK_JS } from "./desktopLink.js";
import { DETAILS_JS, needYouSuffix, panelDetailEntry } from "./details.js";
import { noteEyebrow } from "./eyebrow.js";
import { FIELDS_JS } from "./fields.js";
import { FIT_ROWS_JS } from "./fitRows.js";
import { noteFooter } from "./footer.js";
import { LIFECYCLE_JS } from "./lifecycle.js";
import { LEVEL_OFFSET, type NoteLevel, type PanelStep } from "./panelWire.js";
import { TRIAGE_JS, TRIAGE_STATE_FRESH_MS } from "./triage.js";
import type { TriageNotePaths } from "./triagePaths.js";

export type { NoteLevel } from "./panelWire.js";

/**
 * The panel's width in points.
 *
 * Chosen against the cap in `../step.ts`: 120 characters of the 15pt system font wrap to three lines at this
 * width and still read. Reproduce by posting a step whose `what` is exactly `WHAT_CAP` characters.
 */
export const PANEL_WIDTH = 420;

/**
 * How often the panel looks at its buttons and its own marker, in seconds.
 *
 * It is the click latency too, per the button note above — fast enough that pressing **Done** feels like a
 * button rather than a form, and idle otherwise. Measured with this value: 0.2% of a core at rest.
 *
 * It is an IDLE WAIT rather than a timer: an event already queued returns immediately, so under real mouse
 * traffic the loop turns over faster than this, and a long AppKit tracking session can make one turn take
 * longer. Nothing in the loop assumes a fixed period, so the only thing this number bounds is how stale the
 * caption can look. The clipboard check reads the pasteboard's ownership count first and its string only
 * when that count still matches, which is the shape that keeps a per-poll read off the pathological path.
 */
export const POLL_SECONDS = 0.25;

/** The margin every row and the button band are inset by, in points. */
export const PANEL_PAD = 20;

/**
 * One button's width in points.
 *
 * Narrower than the 96 the band carried before **Copy** joined it, which is what lets four buttons —
 * `Open`, `Copy`, `Not now…`, `Done`, or the snooze band's three answers and `Back` — sit in one 420pt band
 * without touching. `panel.test.ts` asserts the gap
 * rather than trusting this sentence.
 */
export const PANEL_BUTTON_WIDTH = 84;

/** The space between two buttons of the same group, in points. */
export const PANEL_BUTTON_GAP = 8;

/** What the panel is handed about the step it draws, plus where to leave its answer. */
export interface NotePanelInput {
  readonly step: HandStep;
  /** The directory a marker is written into when the owner answers. */
  readonly markerDir: string;
  /** The step's wanted-token file, written by raises alone; a different token there that has drawn closes this note. */
  readonly wantPath: string;
  /** The live directory, where a failed raise leaves `<token>.failed` and every panel beats. */
  readonly liveDir: string;
  /** This panel's own beat file, which it alone writes while it is up. */
  readonly beatPath: string;
  /** This raise's own token. */
  readonly token: string;
  /** The cascade slot this raise reserved (`./cascade.ts`). */
  readonly slot: number;
  /** The window level it floats at. */
  readonly level: NoteLevel;
  /** The console origin its links are minted under, so a link there opens in the desktop app (`./desktopLink.ts`). */
  readonly consoleBase: string;
  /** Where rapid triage's on-state is read and its presses land (`./triagePaths.ts`). */
  readonly triage: TriageNotePaths;
  /** Which kind answers the More… page offers — the monitor lane's decision, none for a step it does not speak for. */
  readonly kindAnswers: KindAnswerOffer;
}

/**
 * The constant half of the program — every line of it, with no value from any step in it.
 *
 * Kept as one template rather than assembled from pieces so that reading this file shows the whole thing the
 * machine runs. It reads exactly one name from outside itself, `STEP`, which the line above it declares.
 */
const PROGRAM = `
ObjC.import('AppKit');
ObjC.import('Foundation');
ObjC.import('stdlib');

function nsstr(value) { return $(value); }
${OPEN_LINK_JS}
${SNOOZE_JS}
${KIND_ANSWERS_JS}

${LIFECYCLE_JS}
// The pid before anything else: the cascade slot is held on whether this process lives (../slots.ts), since a held
// button stalls the beat, and from the first instruction there is no stretch where a live panel holds no slot.
nsstr(String($.NSProcessInfo.processInfo.processIdentifier)).writeToFileAtomicallyEncodingError(
  nsstr(STEP.beatPath + '.pid'), true, $.NSUTF8StringEncoding, null);
if (!mayDraw()) { $.exit(0); }

var app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);

${CLIPBOARD_JS}

var PAD = STEP.pad;
var inner = STEP.width - PAD * 2;

${FIELDS_JS}

var rows = [];
rows.push({ view: label(STEP.eyebrow, 10, $.NSFontWeightBold, $.NSColor.tertiaryLabelColor), gap: 8 });
rows.push({ view: label(STEP.what, 16, $.NSFontWeightSemibold, $.NSColor.labelColor), gap: 10 });
// THE QUOTES: the room's own words, ABOVE the fold and directly under the sentence — a live incident's note opens on
// two or three lines from its channel. Ordinary rows, so the overflow fit below shrinks them like any other, and
// each is a click target opening its permalink once the rows are laid out.
var quoteViews = [];
for (var qi = 0; qi < STEP.quotes.length; qi += 1) {
  var quoteView = label(STEP.quotes[qi].line, 13, $.NSFontWeightRegular, $.NSColor.secondaryLabelColor);
  quoteViews.push({ view: quoteView, url: STEP.quotes[qi].url, button: null });
  rows.push({ view: quoteView, gap: qi === STEP.quotes.length - 1 ? 10 : 6 });
}
var literalField = null;
if (STEP.literal.length > 0) {
  literalField = mono(STEP.literal);
  // Sized on the LONGER of the two captions, because the row's height is measured once at layout and never
  // recomputed: built on the shorter one, the other would clip the first time the clipboard moved on.
  clipboardLabel = label(CLIPBOARD_MOVED_ON, 11, $.NSFontWeightRegular, $.NSColor.tertiaryLabelColor);
  rows.push({ view: literalField, gap: 4 });
  rows.push({ view: clipboardLabel, gap: 10 });
}
${CHECKLIST_JS}
checklistRows();
if (STEP.where.length > 0) {
  rows.push({ view: label(STEP.where, 13, $.NSFontWeightRegular, $.NSColor.secondaryLabelColor), gap: 10 });
}
if (STEP.unaddressed.length > 0) { rows.push({ view: label('No link: ' + STEP.unaddressed, 13, $.NSFontWeightRegular, $.NSColor.secondaryLabelColor), gap: 10 }); }
// THE DISCLOSURE ROW: a step's details stay folded behind it until the owner opens them (rule 7), as a drop-down showing everything failing, when it
// failed and why. The row is its own
// last line, so the unblocks line above it keeps a gap; the details region itself is never in rows — it is
// laid out only when opened, below every row and above the buttons, by toggleDetails.
var hasDetails = STEP.detailEntries.length > 0;
rows.push({ view: label(STEP.unblocks, 11, $.NSFontWeightRegular, $.NSColor.tertiaryLabelColor), gap: hasDetails ? 8 : 0 });
var detailsToggle = null;
if (hasDetails) {
  detailsToggle = label(detailsTitle(false), 12, $.NSFontWeightSemibold, $.NSColor.linkColor);
  rows.push({ view: detailsToggle, gap: 0 });
}

var BUTTON_BAND = 52;
var FIXED_HEIGHT = PAD + BUTTON_BAND + PAD;

function measureContent() {
  var total = FIXED_HEIGHT;
  for (var r = 0; r < rows.length; r += 1) { total += rows[r].view.frame.size.height + rows[r].gap; }
  return total;
}

// The overflow fit is one piece of arithmetic with its own tests, so it lives in ./fitRows.ts and arrives
// here as SOURCE: this program runs in its own process and can import nothing from this repository.
${FIT_ROWS_JS}

// The literal's floor is higher than every other row's because it is the one row the owner READS rather than
// recognises, and it is the only one whose clipping the caption can report. A clipped what, where or
// unblocks row is simply shorter, and the whole step comes back from slopweaver hand list --json, which
// prints every field and raises no panel — hand show would redraw the SAME fitted note and copy again.
// Neither costs the owner the COPY — the whole literal goes on the pasteboard before any of this runs.
var ROW_FLOOR = 18;
var LITERAL_MIN_HEIGHT = 48;
var SCREEN_MARGIN = 48;
var MAX_CONTENT_HEIGHT = $.NSScreen.mainScreen.visibleFrame.size.height - SCREEN_MARGIN;

var plan = [];
for (var p = 0; p < rows.length; p += 1) {
  var floor = ROW_FLOOR;
  if (rows[p].view === literalField) { floor = LITERAL_MIN_HEIGHT; }
  plan.push({ floor: floor, gap: Number(rows[p].gap), height: Number(rows[p].view.frame.size.height) });
}
var fitted = fitRows(plan, FIXED_HEIGHT, MAX_CONTENT_HEIGHT);
for (var q = 0; q < rows.length; q += 1) {
  if (fitted[q] < plan[q].height) {
    if (rows[q].view === literalField) { literalClipped = true; }
    var shrunk = rows[q].view.frame;
    rows[q].view.setFrame($.NSMakeRect(shrunk.origin.x, shrunk.origin.y, shrunk.size.width, fitted[q]));
  }
}

var contentHeight = measureContent();

var mask = $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable |
  $.NSWindowStyleMaskFullSizeContentView | $.NSWindowStyleMaskNonactivatingPanel;
var panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(
  $.NSMakeRect(0, 0, STEP.width, contentHeight), mask, $.NSBackingStoreBuffered, false);
// Number() first: the bridge hands the constant back as an object, and + on it would concatenate.
panel.setLevel(Number($.NSFloatingWindowLevel) + STEP.levelOffset);
panel.setTitlebarAppearsTransparent(true);
panel.setTitleVisibility($.NSWindowTitleHidden);
panel.setMovableByWindowBackground(true);
panel.setReleasedWhenClosed(false);
panel.setHidesOnDeactivate(false);
// The close button too: a red dot is the bare dismiss this note never offers. Not now… is the way off screen.
panel.standardWindowButton($.NSWindowCloseButton).setHidden(true);
panel.standardWindowButton($.NSWindowZoomButton).setHidden(true);
panel.standardWindowButton($.NSWindowMiniaturizeButton).setHidden(true);

var effect = $.NSVisualEffectView.alloc.initWithFrame($.NSMakeRect(0, 0, STEP.width, contentHeight));
effect.setMaterial($.NSVisualEffectMaterialHUDWindow);
effect.setBlendingMode($.NSVisualEffectBlendingModeBehindWindow);
effect.setState($.NSVisualEffectStateActive);
effect.setAutoresizingMask($.NSViewWidthSizable | $.NSViewHeightSizable);
panel.setContentView(effect);

var accent = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 4, contentHeight));
accent.setWantsLayer(true);
accent.layer.setBackgroundColor($.NSColor.controlAccentColor.CGColor);
accent.setAutoresizingMask($.NSViewHeightSizable);
effect.addSubview(accent);

// Every row is pinned to the TOP (a flexible bottom margin) and the buttons to the bottom, so opening the
// details grows the panel downward between them and nothing has to be moved by hand.
var y = contentHeight - PAD;
for (var i = 0; i < rows.length; i += 1) {
  var view = rows[i].view;
  y -= view.frame.size.height;
  view.setFrameOrigin($.NSMakePoint(view.frame.origin.x, y));
  view.setAutoresizingMask($.NSViewMinYMargin);
  effect.addSubview(view);
  y -= rows[i].gap;
}

${DETAILS_JS}

${BAND_JS}

${TRIAGE_JS}

// CLICKING THE COMMAND ITSELF copies it, which is the gesture people reach for. A selectable
// NSTextField did not serve it IN THIS CONFIGURATION: selecting text needs a field editor, the field editor
// needs the window to be key, and measured on this panel — nonactivating, Accessory policy,
// orderFrontRegardless — a synthesized drag across the literal delivered ONE event, highlighted nothing,
// and a Cmd-C after it left the pasteboard on its sentinel. Whether some other spelling could take key
// without activating the app was not established and is not worth chasing: the never-steals-focus property
// is the note's reason to exist. A transparent NSButton over the literal's own frame takes the click
// instead and draws nothing — AppKit documents that a transparent button still tracks the mouse.
var literalOverlay = null;
if (literalField !== null) {
  literalOverlay = $.NSButton.alloc.initWithFrame(literalField.frame);
  literalOverlay.setTitle(nsstr(''));
  literalOverlay.setTransparent(true);
  literalOverlay.setButtonType($.NSButtonTypePushOnPushOff);
  literalOverlay.setAutoresizingMask($.NSViewMinYMargin);
  effect.addSubview(literalOverlay);
}
// The same transparent button over each quote's own frame: a click opens its permalink in the default browser.
for (var qo = 0; qo < quoteViews.length; qo += 1) {
  var quoteOverlay = $.NSButton.alloc.initWithFrame(quoteViews[qo].view.frame);
  quoteOverlay.setTitle(nsstr(''));
  quoteOverlay.setTransparent(true);
  quoteOverlay.setButtonType($.NSButtonTypePushOnPushOff);
  quoteOverlay.setAutoresizingMask($.NSViewMinYMargin);
  effect.addSubview(quoteOverlay);
  quoteViews[qo].button = quoteOverlay;
}
checklistOverlays();

// THE CASCADE (./cascade.ts): slot 0 is the top-right corner, each later slot a step down and left, so every
// older note's eyebrow and first line stay visible above a newer one; the meeting-prep level's own cascade runs
// from the top-left. Measured on the CLOSED panel: opening the details grows it downward from wherever it then
// sits (./details.ts).
${CASCADE_JS}
var visible = $.NSScreen.mainScreen.visibleFrame;
var origin = cascadeOrigin(STEP.slot, {
  x: Number(visible.origin.x), y: Number(visible.origin.y),
  width: Number(visible.size.width), height: Number(visible.size.height),
}, STEP.width, contentHeight, STEP.cascadeFromLeft);
panel.setFrameTopLeftPoint($.NSMakePoint(origin.x, origin.y));
// Before the first pixel, not on the first poll: the row was BUILT on the longer caption for its height, so
// without this the owner would see the wrong one of the two for up to POLL_SECONDS on every note.
serviceChecklist();
serviceTriage();
refreshClipboardLabel();
panel.orderFrontRegardless;
// The first beat only once the window is up: an older note of this step closes on this beat, so a beat written
// before the window showed would close that note for one that might never draw.
beat();

// The loop pumps NSApplication's own event queue rather than NSRunLoop directly, and that is the whole
// difference between a card the owner can hover and one that beachballs. A bare runUntilDate services timers and
// sources but never DRAINS the app's event queue, so the window server sees an app that is not taking its
// events and draws the spinning wait cursor over its window, as the first shipped note did. Reproduce either way by raising a note with
// slopweaver hand show <id> and running: sample $(pgrep -f Resources/panel.js) 2. The main thread parks in
// _DPSNextEvent now and parked in -[NSRunLoop runUntilDate:] before, with no AppKit event frame above it.
// EVENT_MASK is spelled as a literal because NSEventMaskAny IS THE BUG THAT MADE EVERY BUTTON DEAD.
// NSEventMaskAny is NSUIntegerMax; the JXA bridge hands it back as a double it cannot represent, and what
// arrives at the unsigned parameter matches nothing, so the panel dequeued ZERO events for its whole life
// and no click ever reached a button: the Later and Done buttons did nothing when pressed. Measured on
// the owner's machine by synthesizing a click over the Done button
// with CGEventPost and logging the dequeue count: 0 events with NSEventMaskAny, 5 events and the marker
// written with a literal mask. 2^53-1 is the largest SAFE integer — the point past which consecutive
// integers stop being representable — and it covers bits 0 to 52, which is every NSEventType the installed
// SDK declares (the highest is NSEventTypeMouseCancelled = 40), so nothing is left sitting in the queue.
// Read it out of the header rather than trusting this line:
//   grep -n 'NSEventTypeMouseCancelled' "$(xcrun --show-sdk-path)/System/Library/Frameworks/AppKit.framework/Headers/NSEvent.h"
var EVENT_MASK = 0x1FFFFFFFFFFFFF;

app.finishLaunching;
while (true) {
  var event = app.nextEventMatchingMaskUntilDateInModeDequeue(
    EVENT_MASK,
    $.NSDate.dateWithTimeIntervalSinceNow(STEP.pollSeconds),
    $.NSDefaultRunLoopMode,
    true);
  if (event !== null && !event.isNil()) { app.sendEvent(event); }
  if (serviceBand()) { break; }
  if (pressed(copyButton) || pressed(literalOverlay)) {
    unpress(copyButton);
    unpress(literalOverlay);
    copyLiteral();
  }
  if (pressed(detailsOverlay)) {
    unpress(detailsOverlay);
    toggleDetails();
  }
  for (var d = 0; d < detailsActButtons.length; d += 1) {
    if (pressed(detailsActButtons[d].button)) {
      unpress(detailsActButtons[d].button);
      openLink(detailsActButtons[d].url);
    }
  }
  for (var qp = 0; qp < quoteViews.length; qp += 1) {
    if (pressed(quoteViews[qp].button)) {
      unpress(quoteViews[qp].button);
      openLink(quoteViews[qp].url);
    }
  }
  serviceChecklist();
  serviceTriage();
  refreshClipboardLabel();
  if (markerPresent()) { break; }
  // No marker: a newer raise of THIS step has drawn — hand show, or a newer program build — and carries it. A
  // note of another step never closes this one.
  if (replacementDrawn()) { break; }
  // The close button is hidden, so this is a window closed some other way: read as the shortest snooze, never
  // as a bare dismiss, so the step comes back rather than staying away on an answer the owner never gave.
  if (!panel.isVisible) {
    if (writeMarker(SNOOZE[0].suffix)) { break; }
    panel.orderFrontRegardless;
  }
  refreshBeat();
}
panel.close;
stopBeating();
'closed';
`;

/**
 * The build id of the note program this checkout emits.
 *
 * A digest of {@link PROGRAM} and of nothing else — not the file, not the step. The overview says why that
 * distinction is load-bearing: the bundle is one shared path per home and is rewritten on every raise, so a
 * build read off the file would make every raise supersede every other note.
 *
 * `sha256`, truncated: this identifies a build, it does not defend against one. Two different programs
 * colliding on 16 hex characters is not a threat model, it is a coincidence that will not happen.
 *
 * @returns the hex digest a raise records and a running panel compares itself against
 */
export function handNotePanelBuild(): string {
  return createHash("sha256").update(PROGRAM, "utf8").digest("hex").slice(0, BUILD_ID_CHARS);
}

/** How much of the digest the build id keeps. Enough to distinguish builds; it guards nothing. */
const BUILD_ID_CHARS = 16;

/**
 * The whole JXA program for one step.
 *
 * @param step the validated step to draw
 * @param markerDir where the panel leaves its answer
 * @param wantPath the step's wanted-token file, which only raises write
 * @param liveDir where a failed raise's tombstone is looked for, and a replacement's beat
 * @param beatPath this note's own heartbeat file
 * @param token this raise's own token, unique per raise
 * @param slot the cascade slot the raise reserved
 * @param level the window level the note floats at
 * @param triage where rapid triage's on-state is read and a press of its buttons lands
 * @param kindAnswers which kind answers the band's More… page offers
 * @returns the program, ready to write into a bundle's `Resources/panel.js`
 */
export function handNotePanelSource({
  step,
  markerDir,
  wantPath,
  liveDir,
  beatPath,
  token,
  slot,
  level,
  consoleBase,
  triage,
  kindAnswers,
}: NotePanelInput): string {
  // The seven optionals are flattened by a DESTRUCTURED DEFAULT rather than a `??`: the program has one
  // shape either way, and the empty string is exactly what its own `length > 0` tests read as "no such
  // field on this step".
  const { checklist = [], details = [], literal = "", quotes = [], unaddressed = "", url = "", where = "" } = step;
  const detailEntries = details.map((line) => panelDetailEntry({ line, url }));
  const checklistLines = panelChecklist({ checklist });
  const quoteRows = quotes.map((quote) => ({ line: `“${quote.text}” — ${quote.who}`, url: quote.permalink }));
  // Every link the program can open: Open, a checklist line's page, a detail's act, a quote's permalink.
  const opened = [url, ...[...checklistLines, ...detailEntries, ...quoteRows].map((entry) => entry.url)];
  const panelStep: PanelStep = {
    beatPath,
    build: handNotePanelBuild(),
    buttonGap: PANEL_BUTTON_GAP,
    buttonWidth: PANEL_BUTTON_WIDTH,
    cascadeFromLeft: level === "meeting-prep",
    checklist: checklistLines,
    desktopLinks: desktopLinksFor({ consoleBase, urls: opened }),
    detailCount: details.length,
    detailEntries,
    detailsNeedYou: needYouSuffix({ count: detailEntries.filter((entry) => entry.owner === "you").length }),
    eyebrow: noteEyebrow({ step }),
    id: step.id,
    kindAnswers,
    levelOffset: LEVEL_OFFSET[level],
    literal,
    liveDir,
    markerDir,
    pad: PANEL_PAD,
    pollSeconds: POLL_SECONDS,
    quotes: quoteRows,
    slot,
    token,
    triage: { ...triage, freshMs: TRIAGE_STATE_FRESH_MS },
    unaddressed,
    unblocks: noteFooter({ step }),
    url,
    wantPath,
    what: step.what,
    where,
    width: PANEL_WIDTH,
    witness: step.witness,
  };
  return `const STEP = ${safeJsonStringify({ label: "a hand-step note panel", value: panelStep })};\n${PROGRAM}`;
}
