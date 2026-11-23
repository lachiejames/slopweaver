/**
 * Building the VHS tape that drives one `yarn why` capture, choosing the settled frame it produced, and
 * refusing an input a tape cannot carry.
 *
 * This replaced an `osascript` + Terminal.app path that could not satisfy the standing rule that a proof
 * capture is INVISIBLE. On this macOS a Terminal window's bounds are CLAMPED back onto the desktop —
 * `{2000, 2000, 3400, 2900}` was set and read back as `{11, 236, 1512, 861}` (measured;
 * reproduce with `osascript -e 'tell application "Terminal" to set bounds of window 1 to {2000, 2000,
 * 3400, 2900}' -e 'tell application "Terminal" to get bounds of window 1'`), so "position it past the
 * display" put a real window on the owner's desktop every time. VHS has no window at all: it serves a real
 * pty over loopback with `ttyd` and renders it in a headless browser — confirmed live on this machine,
 * where the only process it adds is
 * `ttyd --port=<n> --interface 127.0.0.1 … --once --writable bash --noprofile`.
 *
 * Three tape facts below are load-bearing, and each was measured against `vhs` 0.11.0 rather than assumed:
 *
 * - **The capture is a FRAME, never VHS's own `Screenshot` command.** `Screenshot` is deferred to the end
 *   of the run and produced by a separate `ffmpeg` pass, and when that pass finds nothing to work with VHS
 *   still exits 0 having written no file: measured 7/8 and 5/6 over repeated identical runs of the same
 *   tape (`for i in $(seq 8); do vhs t.tape; test -f shot.png || echo MISS; done`). Tuning the sleeps
 *   around it only moved the rate. `Output "<dir>/"` instead writes every frame directly as it records, so
 *   the last `frame-text-NNNNN.png` either exists or the run failed — there is no third outcome.
 * - **`Wait` is a real completion signal**, not a timer: a tape whose visible command was
 *   `sleep 12 && yarn why neverthrow` took 22s wall-clock and captured the finished tree, while one with
 *   `Set WaitTimeout 3s` over `sleep 30` failed with `timeout waiting for "Line" to match >$`. That is the
 *   property the retired AppleScript path needed a sentinel file to get, and it is why nothing here sleeps
 *   a fixed guess for the command itself.
 * - **The trailing `Sleep` is what makes the last frame the SETTLED pane.** It holds the finished screen on
 *   camera after `Wait` returns, so the final frames are all the same completed output rather than a
 *   mid-redraw one.
 *
 * The worktree never appears in the tape at all: `vhs` is run with the worktree as its CWD and the pty
 * inherits it (measured — a tape run outside a Yarn project fails `proto::detect::failed` instead). That
 * is deliberate rather than incidental, because a tape string cannot carry an arbitrary path: VHS's
 * `Type "…"` does not honour backslash escapes, so `Type "echo A\"B'C\\D"` typed `echo A\ B C\\D"` into
 * the pty. Anything that must be interpolated is therefore REFUSED unless it is already tape-safe.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type YarnWhyError, YarnWhyErrors, type YarnWhyInputProblem } from "./errors.js";

/**
 * What a VHS double-quoted string genuinely cannot carry: the quote that ends it, the backslash it does
 * not honour, and any control character (a newline would end the tape line). Everything else is fine, so
 * this is the criterion rather than an allowlist of characters a path is expected to use — an installation
 * whose temp dir carries a `+` or a space must still be able to capture a proof.
 */
const TAPE_STRING_UNSAFE = /["\\]|\p{Cc}/u;

/**
 * An npm package name, scoped or plain. The dependency is typed into a real bash pty, not just into the
 * tape, so it is held to a package name rather than merely to what a tape string can hold: `yarn why` is
 * the only command this pane may ever run.
 */
const PACKAGE_NAME = /^@?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)?$/;

/** VHS's own name for one recorded terminal frame, and the number that orders them. */
const TEXT_FRAME = /^frame-text-(\d+)\.png$/;

/** How long `Wait` may block before VHS gives up on one `yarn why` and fails the whole tape. */
const WAIT_TIMEOUT = "120s";
/**
 * Frames per second. Low on purpose: every frame is written to disk as a PNG, and only the last one is
 * ever used, so the default 50 spends 27MB of scratch per pane (measured: 572 text frames for one
 * `yarn why`) to produce the same image this does.
 */
const FRAMERATE = 5;
/**
 * How long the finished output is held on camera before the recording stops. It buys several identical
 * frames of the settled pane, so the last one cannot be a mid-redraw frame.
 */
const SETTLE = "1s";
/** Pane width in pixels — wide enough that a real `yarn why` tree line does not wrap. */
const PANE_WIDTH = 1100;
/**
 * Pane height in pixels. Tall rather than square: a widely-depended-on package (`@clerk/shared` across a
 * real monorepo, measured live) prints a 50-line tree, and the compositor crops the unused rows away
 * afterwards, so an over-tall pane costs nothing while a short one silently truncates the evidence.
 */
const PANE_HEIGHT = 900;

/**
 * Whether a value can sit inside a VHS double-quoted string without being mangled.
 *
 * @param value the value to check
 * @returns whether it carries no quote, backslash or control character
 */
export function isTapeStringSafe({ value }: { value: string }): boolean {
  return value.length > 0 && !TAPE_STRING_UNSAFE.test(value);
}

/**
 * Whether a value is a plain or scoped npm package name — the only thing this pane will type at a shell.
 *
 * @param value the dependency name to check
 * @returns whether it is a well-formed package name
 */
export function isPackageName({ value }: { value: string }): boolean {
  return PACKAGE_NAME.test(value);
}

/**
 * Pick the settled pane out of one recording: the highest-numbered terminal frame VHS wrote.
 *
 * Ordered by the frame's own NUMBER rather than by name, because VHS zero-pads to five digits and a
 * recording long enough to overflow that would sort `frame-text-100000` before `frame-text-99999`.
 *
 * @param names the file names in the recording's frames directory, in any order
 * @returns the last terminal frame's file name, or `undefined` when the recording produced none
 */
export function lastTextFrame({ names }: { names: readonly string[] }): string | undefined {
  const numbered = names.flatMap((name) => {
    const match = TEXT_FRAME.exec(name);
    return match?.[1] === undefined ? [] : [{ index: Number.parseInt(match[1], 10), name }];
  });
  return numbered.toSorted((a, b) => a.index - b.index).at(-1)?.name;
}

/**
 * Build the VHS tape for one `yarn why` capture pane: clear the pty off-recording, run the real command,
 * wait for it to actually finish, and hold the settled output on camera.
 *
 * The tape carries no worktree path — the caller runs `vhs` with the worktree as its CWD (see this
 * module's own doc for why that is a requirement rather than a convenience).
 *
 * @param dependency the dependency name to pass to `yarn why`
 * @param framesDir the ABSOLUTE directory VHS writes this recording's frames into
 * @returns the complete tape source, or every refusal when an input is not tape-safe
 */
export function buildCaptureTape({
  dependency,
  framesDir,
}: {
  dependency: string;
  framesDir: string;
}): Result<string, YarnWhyError> {
  const problems: YarnWhyInputProblem[] = [];
  if (!isPackageName({ value: dependency })) {
    problems.push(YarnWhyErrors.packageNameUnsafe({ dependency }));
  }
  if (!framesDir.startsWith("/")) {
    problems.push(YarnWhyErrors.framesDirRelative({ framesDir }));
  }
  if (!isTapeStringSafe({ value: framesDir })) {
    problems.push(YarnWhyErrors.framesDirTapeUnsafe({ framesDir }));
  }
  if (problems.length > 0) {
    return err(YarnWhyErrors.inputRefused({ problems }));
  }

  return ok(
    [
      "Require yarn",
      `Output "${framesDir}/"`,
      "Set Shell bash",
      "Set FontSize 14",
      `Set Width ${String(PANE_WIDTH)}`,
      `Set Height ${String(PANE_HEIGHT)}`,
      "Set Padding 16",
      "Set TypingSpeed 12ms",
      `Set Framerate ${String(FRAMERATE)}`,
      `Set WaitTimeout ${WAIT_TIMEOUT}`,
      "Hide",
      `Type "clear"`,
      "Enter",
      "Wait",
      "Show",
      `Type "yarn why ${dependency}"`,
      "Enter",
      "Wait",
      `Sleep ${SETTLE}`,
      "",
    ].join("\n"),
  );
}
