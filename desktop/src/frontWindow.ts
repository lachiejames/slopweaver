/**
 * Which application is in front of the owner, and its window's title — the metadata the voice's drift watch samples
 * (`site/components/voice/useDriftWatch.ts`) to notice when the owner has drifted from what they said they would do.
 * The voice calls out the gap between what was said and what is being done.
 *
 * Never a frame: pictures stay out of the voice's drift sample (see the voice-screen doc under
 * `docs/console/`), and this reads names only. The program is fixed — no value is ever spliced into it — and reaches no other application: no System Events,
 * no Apple event, no Accessibility. `NSWorkspace` names the frontmost application; `CGWindowListCopyWindowInfo` gives
 * its frontmost ordinary window's title, which macOS withholds without Screen Recording, so a title is `null` then.
 *
 * Pure: the program text and the parse of what it printed. The process is `frontWindowShell.ts`.
 */
import { isRecord } from "./desktopBridge";

/** The longest application name carried. */
export const FRONT_APP_MAX_CHARS = 60;

/** The longest bundle id carried. */
export const FRONT_BUNDLE_MAX_CHARS = 200;

/** The longest window title carried: matched on the page, never sent anywhere. */
export const FRONT_TITLE_MAX_CHARS = 200;

/**
 * The JXA program `osascript -l JavaScript` runs: one JSON line naming the frontmost application and the title of its
 * frontmost on-screen, ordinary (layer 0) window, or `null` for a title macOS will not give.
 */
export const FRONT_WINDOW_PROGRAM = [
  'ObjC.import("AppKit");',
  'ObjC.import("CoreGraphics");',
  "const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;",
  "const pid = front.processIdentifier;",
  "const options = $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements;",
  "const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(options, $.kCGNullWindowID)));",
  "const own = windows.find((w) => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0);",
  'const title = own !== undefined && typeof own.kCGWindowName === "string" ? own.kCGWindowName : null;',
  "const bundleId = ObjC.unwrap(front.bundleIdentifier);",
  'JSON.stringify({ app: ObjC.unwrap(front.localizedName), bundleId: typeof bundleId === "string" ? bundleId : null, pid, title });',
].join("\n");

/** The application macOS puts in front while the screen is locked. */
const LOGIN_WINDOW_BUNDLE = "com.apple.loginwindow";

/** What the voice's window is answered: the front window, or why there is none to give. */
export type FrontWindowReply =
  { readonly app: string; readonly bundleId: string | null; readonly title: string | null } | { readonly why: string };

/**
 * One text field bounded: control characters gone, whitespace collapsed, capped.
 *
 * @param value the field as printed
 * @param maxChars the cap, in characters
 * @returns the bounded text, or `null` for a non-string or one that is empty once cleaned
 */
function boundedField({ value, maxChars }: { value: unknown; maxChars: number }): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const line = value
    .replaceAll(/\p{Cc}/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (line === "") {
    return null;
  }
  return line.slice(0, maxChars).trimEnd();
}

/**
 * The reply, from what the program printed.
 *
 * @param stdout the program's output: one JSON line
 * @returns the bounded front window, or why it could not be read
 */
export function frontWindowReplyOf({ stdout }: { stdout: string }): FrontWindowReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return { why: "the front window's names did not read as JSON" };
  }
  if (!isRecord(parsed)) {
    return { why: "the front window's names were not one record" };
  }
  const record = parsed;
  const app = boundedField({ maxChars: FRONT_APP_MAX_CHARS, value: record["app"] });
  if (app === null) {
    return { why: "no application is in front" };
  }
  const bundleId = boundedField({ maxChars: FRONT_BUNDLE_MAX_CHARS, value: record["bundleId"] });
  // Measured on a locked screen, `osascript -l JavaScript` over this program printed
  // {"app":"loginwindow","bundleId":"com.apple.loginwindow","title":null}: a lock is no drift, so it is no sample.
  if (bundleId === LOGIN_WINDOW_BUNDLE) {
    return { why: "the owner's screen is locked" };
  }
  return {
    app,
    bundleId,
    title: boundedField({ maxChars: FRONT_TITLE_MAX_CHARS, value: record["title"] }),
  };
}

/**
 * The process id of the application in front, for telling Slopweaver's own windows from anything else. Internal to
 * the main process: {@link frontWindowReplyOf} never carries it across to a page.
 *
 * @param stdout the program's output: one JSON line
 * @returns the process id, or `undefined` when the output names none
 */
export function frontWindowPidOf({ stdout }: { stdout: string }): number | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (!isRecord(parsed)) {
      return undefined;
    }
    const pid = parsed["pid"];
    return typeof pid === "number" && Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}
