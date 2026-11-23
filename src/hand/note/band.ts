/*
 * THE NOTE'S BUTTON BAND — Open, Copy, Not now… and Done, the snooze answers Not now… swaps in, and the kind answers
 * More… swaps in after them — kept as the JS SOURCE `./panel.ts` embeds, the same way `./clipboard.ts` holds the
 * pasteboard and `./lifecycle.ts` the close rules. Needs `nsstr`, `STEP`, `PAD`, `effect`, `writeMarker`, `openLink`,
 * the `SNOOZE` list {@link SNOOZE_JS} declares and the `KIND` list {@link KIND_ANSWERS_JS} declares.
 */
import { safeJsonStringify } from "../../lib/safeJson.js";
import { KIND_ANSWERS, kindAnswerLabel } from "../kindAnswers.js";
import { SNOOZE_CHOICES, snoozeChoiceLabel, snoozeMarkerSuffix } from "../snooze.js";

/**
 * The emitted program's `KIND` list — each kind answer's title, the marker suffix it writes and the `STEP.kindAnswers`
 * field that offers it — and `KIND_SUFFIXES`, which the lifecycle's `markerPresent` reads. A constant of this
 * checkout, like {@link SNOOZE_JS}; WHETHER a step offers each is per step, in `STEP.kindAnswers`.
 */
export const KIND_ANSWERS_JS = `var KIND = ${safeJsonStringify({
  label: "the note's kind answers",
  value: KIND_ANSWERS.map((answer) => ({
    offer: answer === "mute-kind" ? "muteKind" : "whenWorse",
    suffix: answer,
    title: kindAnswerLabel({ answer }),
  })),
})};
var KIND_SUFFIXES = KIND.map(function (kind) { return kind.suffix; });`;

/**
 * The emitted program's `SNOOZE` list — each answer's title and the marker suffix it writes, as one JSON literal.
 * A constant of this checkout, so it sits in the program and its build digest, never in `STEP`: a note drawn
 * before the answers changed is superseded by the next raise like any other old program. Declared before the
 * lifecycle, whose `markerPresent` must know every answer a snooze can leave.
 */
export const SNOOZE_JS = `var SNOOZE = ${safeJsonStringify({
  label: "the note's snooze band",
  value: SNOOZE_CHOICES.map((choice) => ({
    suffix: snoozeMarkerSuffix({ choice }),
    title: snoozeChoiceLabel({ choice }),
  })),
})};`;

/**
 * The emitted program's band: `button`, `pressed`/`unpress`, every band button, `showPage` and `serviceBand`, the
 * per-poll read that answers true once Done, a snooze or a kind answer has landed its marker.
 */
export const BAND_JS = `
var BUTTON_W = STEP.buttonWidth;
var BUTTON_GAP = STEP.buttonGap;

function button(title, x) {
  var b = $.NSButton.alloc.initWithFrame($.NSMakeRect(x, PAD, BUTTON_W, 30));
  b.setTitle(nsstr(title));
  b.setBezelStyle($.NSBezelStyleRounded);
  b.setButtonType($.NSButtonTypePushOnPushOff);
  effect.addSubview(b);
  return b;
}

function pressed(b) {
  if (b === null) { return false; }
  return b.state === $.NSControlStateValueOn;
}

function unpress(b) {
  if (b === null) { return; }
  b.setState($.NSControlStateValueOff);
}

var right = STEP.width - PAD - BUTTON_W;
var doneButton = button('Done', right);
// NEVER A BARE DISMISS. The owner does not press a generic dismiss; they press a button more specific than that,
// one that already answers the question of when the note returns. Not now… swaps the band IN PLACE for the
// answers — each says when the note comes back — and Back restores it. The same hidden/unhidden NSButtons,
// polled by state like every other button here, because a target/action closure is the measured dead end
// in ./panel.ts. The answers come from ../snooze.ts as a constant in this program, so changing them is a new build.
var notNowButton = button('Not now…', right - BUTTON_W - BUTTON_GAP);
var snoozeButtons = [];
for (var s = 0; s < SNOOZE.length; s += 1) {
  var choiceButton = button(SNOOZE[s].title, PAD + s * (BUTTON_W + BUTTON_GAP));
  choiceButton.setHidden(true);
  snoozeButtons.push({ button: choiceButton, suffix: SNOOZE[s].suffix });
}
// THE KIND ANSWERS, one page further. Beside the snooze the owner can say never again for this kind, or remind
// them when it gets worse. A monitor card offers them (STEP.kindAnswers, decided by ../../monitor/noteAnswers.ts); every
// other step offers neither, and its band is exactly the two pages it always was. They are wider than a snooze
// answer because their titles are: two of them, a gap and Back fill the band's width.
var KIND_W = 140;
var kindButtons = [];
var offered = KIND.filter(function (kind) { return STEP.kindAnswers[kind.offer] === true; });
for (var k = 0; k < offered.length; k += 1) {
  var kindX = PAD + k * (KIND_W + BUTTON_GAP);
  var kindButton = button(offered[k].title, kindX);
  kindButton.setFrame($.NSMakeRect(kindX, PAD, KIND_W, 30));
  kindButton.setHidden(true);
  kindButtons.push({ button: kindButton, suffix: offered[k].suffix });
}
var moreButton = null;
if (kindButtons.length > 0) {
  moreButton = button('More…', right);
  moreButton.setHidden(true);
}
var backButton = button('Back', right);
backButton.setHidden(true);
// OPEN IS THE PRIMARY BUTTON, first in the band and drawn in the accent colour, because the artifact is the
// step: handing the owner an "open file:///.../index.html" line to copy into a terminal is the wrong shape, so
// one of the primary buttons opens it. It is FILLED by its own
// layer, borderless, because AppKit's own ways of saying "primary" all failed here. MEASURED on
// this panel: a Return key equivalent and a bezelColor each drew Open exactly as grey as the band's other buttons —
// AppKit desaturates a bezel in any window that is not KEY, and this nonactivating panel never becomes key,
// because never stealing focus is the note's reason to exist. A layer's fill is drawn whatever the key state.
var OPEN_INSET = 3;
var openButton = null;
if (STEP.url.length > 0) {
  openButton = button('Open', PAD);
  openButton.setFrame($.NSMakeRect(PAD + OPEN_INSET, PAD + OPEN_INSET, BUTTON_W - OPEN_INSET * 2, 30 - OPEN_INSET * 2));
  openButton.setBordered(false);
  openButton.setWantsLayer(true);
  openButton.layer.setBackgroundColor($.NSColor.controlAccentColor.CGColor);
  openButton.layer.setCornerRadius(6);
  openButton.setFont($.NSFont.systemFontOfSizeWeight(13, $.NSFontWeightSemibold));
  openButton.setContentTintColor($.NSColor.whiteColor);
}
var copyButton = null;
if (STEP.literal.length > 0) {
  var copyX = PAD;
  if (openButton !== null) { copyX = PAD + BUTTON_W + BUTTON_GAP; }
  copyButton = button('Copy', copyX);
}

var mainBand = [openButton, copyButton, notNowButton, doneButton];
// Three pages: 'main', 'snooze' (Not now…) and 'more' (More…, only where a kind answer applies). The snooze page
// ends in More… when there is a further page and in Back when there is not; the more page ends in Back, to main.
function showPage(page) {
  for (var m = 0; m < mainBand.length; m += 1) {
    if (mainBand[m] !== null) { mainBand[m].setHidden(page !== 'main'); }
  }
  for (var n = 0; n < snoozeButtons.length; n += 1) { snoozeButtons[n].button.setHidden(page !== 'snooze'); }
  for (var q = 0; q < kindButtons.length; q += 1) { kindButtons[q].button.setHidden(page !== 'more'); }
  if (moreButton !== null) { moreButton.setHidden(page !== 'snooze'); }
  backButton.setHidden(!(page === 'more' || (page === 'snooze' && moreButton === null)));
}

function pressedAnswer(answers) {
  for (var c = 0; c < answers.length; c += 1) {
    if (pressed(answers[c].button)) { return answers[c].suffix; }
  }
  return null;
}

function unpressAll(answers) {
  for (var u = 0; u < answers.length; u += 1) { unpress(answers[u].button); }
}

// Each answer closes the note only once its marker landed; one that did not is unpressed and the note stays up.
function serviceBand() {
  if (pressed(doneButton)) {
    if (writeMarker('done')) { return true; }
    unpress(doneButton);
  }
  var snoozed = pressedAnswer(snoozeButtons);
  if (snoozed !== null) {
    if (writeMarker(snoozed)) { return true; }
    unpressAll(snoozeButtons);
  }
  var kindAnswer = pressedAnswer(kindButtons);
  if (kindAnswer !== null) {
    if (writeMarker(kindAnswer)) { return true; }
    unpressAll(kindButtons);
  }
  if (pressed(notNowButton)) {
    unpress(notNowButton);
    showPage('snooze');
  }
  if (pressed(moreButton)) {
    unpress(moreButton);
    showPage('more');
  }
  if (pressed(backButton)) {
    unpress(backButton);
    showPage('main');
  }
  if (pressed(openButton)) {
    unpress(openButton);
    openLink(STEP.url);
  }
  return false;
}
`;
