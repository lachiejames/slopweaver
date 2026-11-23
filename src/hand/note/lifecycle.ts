/*
 * THE NOTE'S LIFECYCLE — how a running panel learns it should close, and what it leaves behind — kept as
 * the JS SOURCE `./panel.ts` embeds, the same way `./fitRows.ts` holds the layout arithmetic.
 *
 * Every note is about ONE step, and only that step's own files move it. Before it draws, a note waits on a
 * newer raise of its own step (`newerRaisePending`) and draws only if that raise fails or never draws
 * (`mayDraw`). Once drawn, two things close it without the owner's click: a marker file (`hand done`, `hand snooze`),
 * and a newer raise of its own step that has DRAWN (`replacementDrawn`) — `hand show`, or a raise on a newer
 * program build. A note of ANOTHER step never closes this one: notes stack. The beat is
 * the one file a panel writes for a raise to read, and a closing note overwrites it with {@link CLOSED_BEAT}
 * rather than deleting it. The protocol is `./liveness.ts`.
 */
import { BEAT_WINDOW_MS, CLOSED_BEAT, RAISE_TOKEN_SOURCE, STARTUP_WINDOW_MS } from "./liveness.js";

/** The emitted program's marker and liveness functions, as source. Needs `nsstr`, `STEP`, `SNOOZE` and `KIND_SUFFIXES`. */
export const LIFECYCLE_JS = `
// The stamp is ISO 8601 because a snooze's wake time is counted from it (../snooze.ts): the press instant, not
// the instant some later reconcile happened to read the marker. Returns whether it landed: a panel closes only on a
// marker that exists, so a press it could not record leaves the note up to be pressed again.
function writeMarker(suffix) {
  var path = STEP.markerDir + '/' + STEP.id + '.' + suffix;
  var when = new Date().toISOString();
  return nsstr(when).writeToFileAtomicallyEncodingError(nsstr(path), true, $.NSUTF8StringEncoding, null) === true;
}

// A marker counts once it reads back as a stamp, the way noteStanding judges one: a path something else occupies
// (a directory, an empty file) is no press, so the note stays up rather than closing on an answer nothing recorded.
function markerPresent() {
  var suffixes = ['done', 'later'].concat(SNOOZE.map(function (choice) { return choice.suffix; }), KIND_SUFFIXES);
  for (var i = 0; i < suffixes.length; i += 1) {
    var path = nsstr(STEP.markerDir + '/' + STEP.id + '.' + suffixes[i]);
    var text = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null));
    if (typeof text === 'string' && text.trim().length > 0) { return true; }
  }
  return false;
}

// ONE NOTE PER STEP. hand post raised a note and hand push raised a second for the same arrival twelve
// seconds later, and the owner met both at once. The RAISER writes
// the newest raise's token into STEP.wantPath and nothing else ever writes it; this note only READS it. This
// note's own beat file, carrying its build, is the one thing it writes, and a raise reads it to keep a note
// already up rather than draw a second. No note writes a file another note reads as ownership, which is what a
// read-then-write race needs (see ../liveness.ts). Checked BEFORE the clipboard or the window: a note raised a
// moment before a newer one of its own step draws nothing at all.
var beatManager = $.NSFileManager.defaultManager;
var LIVE_REFRESH_SECONDS = 1;
var CLOSED_BEAT = '${CLOSED_BEAT}';
var STARTUP_SECONDS = ${String(STARTUP_WINDOW_MS / 1000)};
var BEAT_SECONDS = ${String(BEAT_WINDOW_MS / 1000)};
var WAIT_SECONDS = 0.25;
var RAISE_TOKEN = /${RAISE_TOKEN_SOURCE}/;
var beatWrittenAt = 0;

// A raise that FAILED leaves <token>.failed rather than deleting what it wrote: a compare-then-delete could
// remove a newer raise's claim written in between, and a tombstone only ever names
// its own raise. A raise this note WAITED OUT counts the same: see mayDraw.
var outwaited = {};

function failedRaise(token) {
  if (outwaited[token] === true) { return true; }
  return beatManager.fileExistsAtPath(nsstr(STEP.liveDir + '/' + token + '.failed'));
}

// The newest raise of this step, as its want file names it; empty when there is none.
function wantedToken() {
  var wanted = $.NSString.stringWithContentsOfFileEncodingError(nsstr(STEP.wantPath), $.NSUTF8StringEncoding, null);
  if (wanted.isNil()) { return ''; }
  return String(wanted.js).trim();
}

// A newer raise of this step that has not failed, and that this note has not waited out.
function newerRaisePending() {
  var token = wantedToken();
  return token.length > 0 && token !== STEP.token && !failedRaise(token);
}

// Whether the panel of this step's raise \`token\` has DRAWN and is still up: its beat is there, is not the closed
// tombstone, and is inside the beat window — never one from the future, a clock set back. A failure tombstone does
// not outrank this proof: a launcher can report failure after its panel wrote a beat.
function raiseDrawn(token) {
  var path = STEP.liveDir + '/' + STEP.id + '.' + token + '.beat';
  var beatText = $.NSString.stringWithContentsOfFileEncodingError(nsstr(path), $.NSUTF8StringEncoding, null);
  if (beatText.isNil()) { return false; }
  var build = String(beatText.js).trim();
  if (build.length === 0 || build === CLOSED_BEAT) { return false; }
  var attributes = beatManager.attributesOfItemAtPathError(nsstr(path), null);
  if (attributes.isNil()) { return false; }
  var age = Number($.NSDate.date.timeIntervalSince1970) - Number(attributes.fileModificationDate.timeIntervalSince1970);
  return age >= 0 && age < BEAT_SECONDS;
}

// A newer raise of this step whose panel has drawn and is still up. The wanted token first, then every other beat
// of this step whose token sorts after this note's own — tokens are minted in time order (../liveness.ts) — because
// the want file names only the NEWEST raise: a second raise that drew, then a third that took the want file and
// failed, would otherwise leave this note standing beside the second until the owner answered one.
function replacementDrawn() {
  var token = wantedToken();
  if (token.length > 0 && token !== STEP.token && raiseDrawn(token)) { return true; }
  var listing = beatManager.contentsOfDirectoryAtPathError(nsstr(STEP.liveDir), null);
  if (listing.isNil()) { return false; }
  var names = listing.js;
  var prefix = STEP.id + '.';
  for (var i = 0; i < names.length; i += 1) {
    var name = String(names[i].js);
    if (name.indexOf(prefix) !== 0 || name.slice(-5) !== '.beat') { continue; }
    // A step id may carry a dot, so 'a.' also prefixes step 'a.b': only a whole token, which never does, counts.
    var other = name.slice(prefix.length, -5);
    if (RAISE_TOKEN.test(other) && other > STEP.token && raiseDrawn(other)) { return true; }
  }
  return false;
}

// Whether this note draws at all. Outranked by a newer raise of its own step, it WAITS rather than exits: exiting
// at once left no note when the newer raise went on to fail. It gives way the moment that
// raise has drawn. A raise that has neither drawn nor failed by the end of the startup window is DEAD — its panel
// launched and died, leaving no tombstone — which is how every raise already reads it, so this note counts it as
// failed and draws. A raise newer still restarts the wait.
function mayDraw() {
  var waited = 0;
  while (newerRaisePending()) {
    if (replacementDrawn()) { return false; }
    if (waited >= STARTUP_SECONDS) {
      outwaited[wantedToken()] = true;
      waited = 0;
    } else {
      $.NSThread.sleepForTimeInterval(WAIT_SECONDS);
      waited += WAIT_SECONDS;
    }
  }
  return true;
}

function beat() {
  nsstr(STEP.build).writeToFileAtomicallyEncodingError(nsstr(STEP.beatPath), true, $.NSUTF8StringEncoding, null);
  beatWrittenAt = Number($.NSDate.date.timeIntervalSince1970);
}

// Also rewritten when the clock has gone BACK past the last write: a future-dated beat reads as dead, so a
// note left beating in the future read as gone to every raise until the clock caught up.
function refreshBeat() {
  var sinceWritten = Number($.NSDate.date.timeIntervalSince1970) - beatWrittenAt;
  if (sinceWritten >= LIVE_REFRESH_SECONDS || sinceWritten < 0) { beat(); }
}

// A CLOSED note leaves a tombstone rather than no beat: with the beat gone, a note closed seconds after its
// raise reads exactly like one still starting, and the next keep raise would draw nothing (see ../liveness.ts).
function stopBeating() {
  nsstr(CLOSED_BEAT).writeToFileAtomicallyEncodingError(nsstr(STEP.beatPath), true, $.NSUTF8StringEncoding, null);
}
`;
