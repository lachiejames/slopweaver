/*
 * THE NOTE'S CHECKLIST — a checklist step drawn as the script the owner runs through, one tickable line at a time, each
 * command its own block they click to copy and each value's place on the page named under its line — kept as the JS
 * SOURCE `./panel.ts` embeds, the same way `./clipboard.ts` holds the pasteboard. Needs `nsstr`, `label`, `mono`,
 * `rows`, `effect`, `copyText`, `clipboardHolds`, `openLink`, `PAD` and `STEP`.
 *
 * One click copies a command and the line says "copied"; the instructions can be checked off as they go.
 *
 * A TICK IS THE OVERLAY'S OWN STATE. Every control here is a transparent `NSButtonTypePushOnPushOff` laid over the
 * row it serves, for the reason `./panel.ts` § "The buttons carry NO target and NO action" measured: an ObjC closure
 * hangs the bundled program. A copy overlay is pressed, read and released each poll; a tick overlay is never
 * released, so its `On` IS the tick and the box drawn beside the line is re-derived from it.
 *
 * NOTHING IS COPIED AT LAUNCH. A checklist step has no `--literal` (`../checklist.ts` refuses one beside it), and its
 * commands run one at a time — copying the first unasked would put a secret's prompt on the owner's clipboard before they have
 * opened the page holding its value.
 */
import type { HandChecklistItem } from "../checklist.js";

/** A checklist line as the program reads it: every optional flattened to a string, the breadcrumb pre-joined. */
export interface PanelChecklistLine {
  readonly action: string;
  readonly command: string;
  /** `Additional information › Client ID`, or empty. */
  readonly crumb: string;
  readonly url: string;
}

/**
 * A step's checklist flattened for the program, which has one shape either way — an empty string is what its own
 * `length > 0` tests read as "no such field on this line".
 *
 * @param checklist the step's checklist, empty when it has none
 * @returns one program line per checklist line, the breadcrumb joined the way the console draws it
 */
export function panelChecklist({ checklist }: { checklist: readonly HandChecklistItem[] }): PanelChecklistLine[] {
  return checklist.map(({ action, command = "", find = [], url = "" }) => ({
    action,
    command,
    crumb: find.join(" › "),
    url,
  }));
}

/** The emitted program's `checklistRows`, `checklistOverlays` and `serviceChecklist`. */
export const CHECKLIST_JS = `
var CHECK_OPEN = '\\u2610';
var CHECK_DONE = '\\u2611';
// The caption row is measured once, on COPY_IDLE, so COPY_DONE stays the shorter of the two and never clips.
var COPY_IDLE = 'click the command to copy it';
var COPY_DONE = 'copied \\u2713';
var LINE_OPEN = 'Open the page \\u203a';
var checklistLines = [];

function tickText(n, line, ticked) {
  var box = CHECK_OPEN;
  if (ticked) { box = CHECK_DONE; }
  return box + '  ' + String(n + 1) + '. ' + line.action;
}

// Pushed into rows BEFORE layout, so the fit and the panel's height count every line; the overlays follow it.
function checklistRows() {
  for (var c = 0; c < STEP.checklist.length; c += 1) {
    var line = STEP.checklist[c];
    var drawn = { line: line, tick: null, tickOverlay: null, field: null, fieldOverlay: null, caption: null, link: null, linkOverlay: null };
    drawn.tick = label(tickText(c, line, false), 14, $.NSFontWeightMedium, $.NSColor.labelColor);
    rows.push({ view: drawn.tick, gap: 4 });
    if (line.crumb.length > 0) {
      rows.push({ view: label('Find it under: ' + line.crumb, 12, $.NSFontWeightRegular, $.NSColor.secondaryLabelColor), gap: 4 });
    }
    if (line.url.length > 0) {
      drawn.link = label(LINE_OPEN, 12, $.NSFontWeightSemibold, $.NSColor.linkColor);
      rows.push({ view: drawn.link, gap: 4 });
    }
    if (line.command.length > 0) {
      drawn.field = mono(line.command);
      drawn.caption = label(COPY_IDLE, 11, $.NSFontWeightRegular, $.NSColor.tertiaryLabelColor);
      rows.push({ view: drawn.field, gap: 2 });
      rows.push({ view: drawn.caption, gap: 4 });
    }
    rows[rows.length - 1].gap = 12;
    checklistLines.push(drawn);
  }
}

function overlay(view) {
  var b = $.NSButton.alloc.initWithFrame(view.frame);
  b.setTitle(nsstr(''));
  b.setTransparent(true);
  b.setButtonType($.NSButtonTypePushOnPushOff);
  b.setAutoresizingMask($.NSViewMinYMargin);
  effect.addSubview(b);
  return b;
}

// After layout, so each overlay takes its row's final frame.
function checklistOverlays() {
  for (var o = 0; o < checklistLines.length; o += 1) {
    var drawn = checklistLines[o];
    drawn.tickOverlay = overlay(drawn.tick);
    if (drawn.field !== null) { drawn.fieldOverlay = overlay(drawn.field); }
    if (drawn.link !== null) { drawn.linkOverlay = overlay(drawn.link); }
  }
}

function setIfChanged(field, text) {
  if (String(field.stringValue) !== text) { field.setStringValue(nsstr(text)); }
}

// Once per poll: a pressed command copies, a pressed link opens, and every box and caption is re-derived.
function serviceChecklist() {
  for (var s = 0; s < checklistLines.length; s += 1) {
    var drawn = checklistLines[s];
    if (drawn.fieldOverlay !== null && drawn.fieldOverlay.state === $.NSControlStateValueOn) {
      drawn.fieldOverlay.setState($.NSControlStateValueOff);
      copyText(drawn.line.command);
    }
    if (drawn.linkOverlay !== null && drawn.linkOverlay.state === $.NSControlStateValueOn) {
      drawn.linkOverlay.setState($.NSControlStateValueOff);
      openLink(drawn.line.url);
    }
    setIfChanged(drawn.tick, tickText(s, drawn.line, drawn.tickOverlay.state === $.NSControlStateValueOn));
    if (drawn.caption !== null) {
      var copied = COPY_IDLE;
      if (clipboardHolds(drawn.line.command)) { copied = COPY_DONE; }
      setIfChanged(drawn.caption, copied);
    }
  }
}
`;
