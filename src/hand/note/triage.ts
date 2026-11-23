/*
 * THE NOTE'S TRIAGE BUTTONS — Pause timer (Resume timer while paused) and Triage off, which exist only while rapid
 * triage is on: floating notes gain "pause timer" and "turn triage off" while triage mode is on.
 * Kept as the JS SOURCE `./panel.ts` embeds, the way `./band.ts` holds the band. Needs `nsstr`, `STEP`, `PAD`,
 * `effect`, `contentHeight`, `pressed` and `unpress`.
 *
 * They sit on the eyebrow's line at the top right, where the short eyebrow leaves the row empty, so showing them moves
 * nothing and the note never resizes; pinned to the top like every row, they stay put when the details open. Whether
 * triage is on is the desktop shell's `state.json` (`./triagePaths.ts`), read each poll and believed only while it is
 * fresher than `STEP.triage.freshMs` — the shell rewrites it every half second while triage runs, so a shell that quit
 * leaves the buttons gone within seconds rather than standing over nothing. A press drops one empty file named for
 * itself into the commands directory, written plainly rather than atomically: an atomic write's temporary file is a
 * foreign name the shell sweeps, and the name alone carries the press. Every bridge call sits in a `try`, so a
 * malformed file or a refused write costs the buttons and never the note. Polled by state like every other button
 * here: a target/action closure is the measured dead end in `./panel.ts`.
 */

/** How old the shell's triage file may be and still show the buttons, in milliseconds: six of its half-second beats. */
export const TRIAGE_STATE_FRESH_MS = 3_000;

/** The emitted program's triage buttons and `serviceTriage`, the per-poll read and press. */
export const TRIAGE_JS = `
var TRIAGE_GAP = 6;
var TRIAGE_NOT_SENT = 'Not sent, press again';
var TRIAGE_ROW_Y = contentHeight - PAD - 16;

function triageButton(title) {
  var b = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, TRIAGE_ROW_Y, 80, 20));
  b.setTitle(nsstr(title));
  b.setBezelStyle($.NSBezelStyleRounded);
  b.setButtonType($.NSButtonTypePushOnPushOff);
  b.setControlSize($.NSControlSizeSmall);
  b.setFont($.NSFont.systemFontOfSize(11));
  b.setAutoresizingMask($.NSViewMinYMargin);
  b.setHidden(true);
  effect.addSubview(b);
  return b;
}

var triageOffButton = triageButton('Triage off');
var triagePauseButton = triageButton('Pause timer');
var triagePaused = false;

// Right-aligned on the eyebrow's line, each sized to its own title, so Resume timer never clips.
function placeTriage() {
  triageOffButton.sizeToFit;
  triagePauseButton.sizeToFit;
  var offWidth = Number(triageOffButton.frame.size.width);
  var pauseWidth = Number(triagePauseButton.frame.size.width);
  var offX = STEP.width - PAD - offWidth;
  triageOffButton.setFrameOrigin($.NSMakePoint(offX, TRIAGE_ROW_Y));
  triagePauseButton.setFrameOrigin($.NSMakePoint(offX - TRIAGE_GAP - pauseWidth, TRIAGE_ROW_Y));
}
placeTriage();

function readTriage() {
  try {
    var raw = $.NSString.stringWithContentsOfFileEncodingError(nsstr(STEP.triage.statePath), $.NSUTF8StringEncoding, null);
    if (raw.isNil()) { return null; }
    var parsed = JSON.parse(ObjC.unwrap(raw));
    if (parsed === null || typeof parsed !== 'object' || parsed.on !== true || typeof parsed.writtenMs !== 'number') {
      return null;
    }
    if (Math.abs(Date.now() - parsed.writtenMs) > STEP.triage.freshMs) { return null; }
    return { paused: parsed.paused === true };
  } catch (e) {
    // Expected: the shell renames a whole file into place, so a broken one is never its own; a note that cannot read
    // it draws no buttons, which is what a stale file means too. The note polls again in a moment.
    return null;
  }
}

function writeTriageCommand(command) {
  try {
    var id = String(ObjC.unwrap($.NSUUID.UUID.UUIDString)).toLowerCase();
    var name = String(Date.now()) + '-' + id + '.' + command;
    return nsstr('').writeToFileAtomicallyEncodingError(
      nsstr(STEP.triage.commandsDir + '/' + name), false, $.NSUTF8StringEncoding, null);
  } catch (e) {
    // Not swallowed: false makes pressTriage retitle the button "Not sent, press again", so the owner sees the press failed.
    return false;
  }
}

// The press's file, or the button retitled so a failed write shows; the next good press restores both titles.
function pressTriage(button, command) {
  if (!writeTriageCommand(command)) {
    button.setTitle(nsstr(TRIAGE_NOT_SENT));
    placeTriage();
    return;
  }
  triagePauseButton.setTitle(nsstr(triagePaused ? 'Resume timer' : 'Pause timer'));
  triageOffButton.setTitle(nsstr('Triage off'));
  placeTriage();
}

function serviceTriage() {
  var state = readTriage();
  var on = state !== null;
  triageOffButton.setHidden(!on);
  triagePauseButton.setHidden(!on);
  if (on && state.paused !== triagePaused) {
    triagePaused = state.paused;
    triagePauseButton.setTitle(nsstr(triagePaused ? 'Resume timer' : 'Pause timer'));
    placeTriage();
  }
  if (pressed(triagePauseButton)) {
    unpress(triagePauseButton);
    if (on) { pressTriage(triagePauseButton, triagePaused ? 'resume' : 'pause'); }
  }
  if (pressed(triageOffButton)) {
    unpress(triageOffButton);
    if (on) { pressTriage(triageOffButton, 'off'); }
  }
}
`;
