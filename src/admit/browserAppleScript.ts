/**
 * The AppleScript and JXA half of the browser-launch walk: whether an `osascript` program tells a web browser what
 * to do, read in its code only — never a comment, never a string literal the script merely holds. The argv walk
 * (`./browserLaunchArgv.ts`) hands it an inline `-e` program; the command walk (`./browserLaunchCommand.ts`) hands
 * it a heredoc body.
 */
import { isBrowserApplication, isBrowserBundleId } from "./browserApplication.js";
import { type ScriptLanguage, stringSpans, withoutScriptComments } from "./scriptComments.js";

/** An AppleScript or JXA reference to an application by name or id: `tell app "Safari"`, `Application("Arc")`. */
// `¬` continues an AppleScript line, so it separates words wherever whitespace does.
const APPLESCRIPT_TARGETS = [
  /\b(?:application|app)[\s¬]+(id[\s¬]+)?"([^"]+)"/gi,
  /\bApplication\s*\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)\s*\)/g,
] as const;

/** Every JXA `Application(` call, whatever its argument. */
const JXA_APPLICATION_CALL = /\bApplication\s*\(/g;

/**
 * Whether an AppleScript (or JXA) program addresses a web browser by name or bundle id, in its code — never in a
 * comment, and never in a string literal the script only holds.
 *
 * @param program the program text
 * @param language which language's comments and strings are set aside before matching
 * @returns true when it tells a browser to do something
 */
export function appleScriptAddressesBrowser({
  language,
  program: written,
}: {
  language: ScriptLanguage;
  program: string;
}): boolean {
  const program = withoutScriptComments({ language, program: written });
  const spans = stringSpans({ language, program });
  const inCode = ({ at }: { at: number }): boolean => !spans.some(({ end, start }) => at > start && at < end);
  if (tellsBrowser({ inCode, program })) {
    return true;
  }
  // Each match is judged as it is found, so the first browser target returns at once rather than after every
  // call in a long program has been read.
  const literalCalls = new Set<number>();
  for (const match of program.matchAll(APPLESCRIPT_TARGETS[1])) {
    if (!inCode({ at: match.index })) {
      continue;
    }
    if (addressesBrowser({ text: callTarget({ match }) })) {
      return true;
    }
    if (isLiteralCall({ match })) {
      literalCalls.add(match.index);
    }
  }
  // A JXA `Application(…)` whose target is computed at run time — `Application("Saf" + "ari")`, `Application(name)` —
  // cannot be read, so it fails closed as a launch rather than passing unread.
  return (
    language === "javascript" &&
    [...program.matchAll(JXA_APPLICATION_CALL)].some(
      (match) => inCode({ at: match.index }) && !literalCalls.has(match.index),
    )
  );
}

/**
 * Whether an AppleScript `tell application`/`application id` in code names a browser, returning on the first that
 * does.
 *
 * @param inCode whether an index sits in code rather than inside a string
 * @param program the program with its comments stripped
 * @returns true when one addresses a browser
 */
function tellsBrowser({
  inCode,
  program,
}: {
  inCode: (position: { at: number }) => boolean;
  program: string;
}): boolean {
  for (const match of program.matchAll(APPLESCRIPT_TARGETS[0])) {
    const target = match[2]!;
    const byId = match[1] !== undefined;
    const browser = byId ? isBrowserBundleId({ text: target }) : isBrowserApplication({ text: target });
    if (browser && inCode({ at: match.index })) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a name read out of a script names a browser, by application name or bundle id.
 *
 * @param text the name as the script writes it
 * @returns true when it is a browser's
 */
function addressesBrowser({ text }: { text: string }): boolean {
  return isBrowserApplication({ text }) || isBrowserBundleId({ text });
}

/**
 * The target an `Application(…)` match captured, whichever quote spelled it.
 *
 * @param match one match of the call pattern
 * @returns the captured target
 */
function callTarget({ match }: { match: RegExpExecArray }): string {
  return [match[1], match[2], match[3]].find((group) => group !== undefined)!;
}

/**
 * Whether an `Application(…)` match is a literal as written. A template that interpolates is computed at run time
 *, and an escape (`"\x53afari"`) is decoded at run time, so neither is.
 *
 * @param match one match of the call pattern
 * @returns true when the target is read exactly as written
 */
function isLiteralCall({ match }: { match: RegExpExecArray }): boolean {
  const interpolates = Boolean(match[3]?.includes("${"));
  return !callTarget({ match }).includes("\\") && !interpolates;
}

/**
 * The `-e` program an `osascript` command line carries, its fragments joined as osascript joins them.
 *
 * @param args the words after `osascript`
 * @returns the program, or `undefined` when no `-e` is given
 */
export function osascriptInlineProgram({ args }: { args: readonly string[] }): string | undefined {
  const fragments: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if (word === "-e" && args[index + 1] !== undefined) {
      fragments.push(args[index + 1]!);
      index += 1;
    } else if (word.startsWith("-e") && word.length > 2) {
      // osascript takes a short option's value attached too: `-e'tell app "Safari"'` (the r1 review).
      fragments.push(word.slice(2));
    }
  }
  return fragments.length === 0 ? undefined : fragments.join("\n");
}
