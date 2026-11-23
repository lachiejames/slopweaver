/**
 * The admit hook's walk for a shell line that LAUNCHES or drives a browser outside the `slopweaver browser` verbs.
 *
 * AGENTS.md rule 3: a doored provider is reached only through a verb, "never a hand-driven browser, nor a launched
 * one". The Claude-in-Chrome tools were already refused (`./chromeRetirement.ts`), but MEASURED through
 * the installed hook shim, `npx @playwright/cli open --extension`, `open -a 'Google Chrome' <url>` and a Chrome
 * binary run with a remote-debugging port each exited 0, and `osascript` telling Chrome what to do met only the
 * raw-bash gate, which `SLOPWEAVER_ALLOW_BASH=1` opens. The browser-reconnect briefing holds the owner's card on that gap.
 * `slopweaver browser open|read|act|close` is the one browser path: it drives the owner's real Chrome through the Playwright
 * extension relay from code, as a child process this hook never sees, so nothing here can refuse it.
 *
 * A separate walk with its own hatch beside the raw one in `./hookPayload.ts`, for the reason
 * `./adcSigninCommand.ts` gives: `SLOPWEAVER_ALLOW_RAW` and `SLOPWEAVER_ALLOW_BASH` are what a seat reaches for
 * once something is refused, and neither opens this. Only `SLOPWEAVER_ALLOW_BROWSER_LAUNCH` does.
 *
 * Every segment is cut by `commandSegments`, which knows a heredoc body from a command, so a `cat <<EOF` document
 * quoting `open -a Safari …` is data; its words then go through `walkSegments`, which descends into `sh -c`, and
 * `resolvePrograms`, which peels `timeout`, `sudo`, `caffeinate` and the rest — and a shell such a wrapper fronts
 * (`sudo bash -lc '…'`) is walked again here, since `walkSegments` descends only into a shell it sees first, as is
 * the line a wrapper runs from an option's value (`env -S '…'`, `su -c '…'`, `./commandPositions.ts`'s). The
 * argv shapes are `./browserLaunchArgv.ts`'s; an AppleScript or JXA comment naming a browser is not an address. What it still cannot see, by construction: an alias, a function, `eval`, a command
 * held in a variable, a script file's own text, a heredoc inside an `sh -c` payload, an AppleScript target built at
 * run time (a JXA `Application(…)` whose argument is not one literal is refused unread instead), a JXA `Application`
 * reached through another name, and a browser the table in
 * `./browserApplication.ts` does not name. A tripwire, not a fence: its silence proves nothing.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { appleScriptAddressesBrowser } from "./browserAppleScript.js";
import { type BrowserLaunchFinding, browserLaunchArgv } from "./browserLaunchArgv.js";
import { commandStarts, wrapperPayload } from "./commandPositions.js";
import { runnerCallPayload } from "./packageRunnerTargets.js";
import { programName, resolvePrograms } from "./pythonWrappers.js";
import { osascriptLanguage } from "./scriptComments.js";
import { type WalkVerdict, walkSegments } from "./segmentWalk.js";
import { bodySubstitutions, hereStrings, type ShellWord, shellWords, withoutRedirections } from "./shellLexing.js";
import {
  type CommandSegment,
  commandSegments,
  hasCommandSegmentOverride,
  hasInlineEnvironmentOverride,
} from "./shellSegments.js";
import { SHELL_RUNNERS, shellStdinScripts } from "./shellStdinScripts.js";
import { heredocOperatorCount, stdinHeredocIndex } from "./stdinHeredoc.js";
import { programAt } from "./wrappedProgram.js";

/** The escape hatch this walk reads. Ambient: it refuses a local command before anything is launched. */
const BROWSER_LAUNCH_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_BROWSER_LAUNCH";

/** What every refusal names instead — the verbs that ARE the browser door. */
const VERB_ROUTE =
  "use `slopweaver browser open --url <url>` to take a session in the owner's real Chrome, `browser read` to see the page, " +
  "`browser act --do <interaction>` to click, fill, upload or download with a screenshot of its result, and " +
  "`browser close` when done (`/slopweaver:browser`)";

/**
 * How many nested lines (`sudo bash -c`, `env -S`, `su -c`, `$( )`) deep this walk reads; one nested deeper that names
 * anything launch-like is REFUSED unread (`walkNested`), never allowed. Three refused a four-deep `git grep Safari`
 *. The cost tracks the line's LENGTH, not its depth: MEASURED, sixteen nested `$( )`
 * walk in 0.4 ms and a 266 KB sixteen-deep mix of `bash -c`, `$( )` and `sudo env -S` in 109 ms, while quoted
 * `bash -c` doubles per level and is 797 KB by twelve (3.6 s, inside the hook's 30 s). Repro: time
 * `classifyBrowserLaunchCommand` over `"git grep Safari"` wrapped N times in `echo $(…)`.
 */
const MAX_PEELED_SHELLS = 16;

/** `osascript` options that take the next word as their value. */
const OSASCRIPT_VALUED: ReadonlySet<string> = new Set(["-e", "-l", "-s"]);

/**
 * The refusal for one finding, in the register's four-line shape with the launch itself as the command.
 *
 * @param finding what was recognised
 * @returns the refusal
 */
function refusalFor({ finding }: { finding: BrowserLaunchFinding }): WalkVerdict {
  const hatch = { ...hatchFor({ id: "browser-launch" }), command: finding.invocation };
  const route =
    finding.shape === "nested-past-reading"
      ? `a line nested more than ${String(MAX_PEELED_SHELLS)} shells or wrappers deep, which this walk does not read past — flatten it; to reach a browser, ${VERB_ROUTE}`
      : VERB_ROUTE;
  return { blocked: true, message: hatchRefusal({ detail: `${finding.shape}: ${route}`, hatch }) };
}

/**
 * Every program one segment's words could run, wrappers peeled, as plain words.
 *
 * @param words the segment's lexed words
 * @returns each program's words, its program first
 */
function programsOf({ words }: { words: readonly ShellWord[] }): readonly (readonly string[])[] {
  return resolvePrograms({ words: withoutRedirections({ words }) }).flatMap((resolution) =>
    resolution.kind === "program" ? [resolution.words.map((word) => word.text)] : [],
  );
}

/**
 * Every replacement string an `xargs` in these words substitutes at run time: `-I R`/`-J R` (attached too), GNU's
 * `-i[R]` and `--replace[=R]`, whose bare forms mean `{}`. Every word after an `xargs` is read, so a string an option
 * of another program happens to spell is collected too — the fail-closed direction.
 *
 * @param words one segment's lexed words
 * @returns the non-empty replacement strings
 */
function xargsPlaceholders({ words }: { words: readonly ShellWord[] }): readonly string[] {
  const texts = words.map((word) => word.text);
  const start = texts.findIndex((text) => programName({ text }).toLowerCase() === "xargs");
  if (start === -1) {
    return [];
  }
  const found: string[] = [];
  for (let index = start + 1; index < texts.length; index += 1) {
    const text = texts[index]!;
    const attached = /^-[IJ](.+)$|^-i(.+)$|^--replace=(.+)$/.exec(text);
    const value = texts[index + 1];
    if ((text === "-I" || text === "-J") && value !== undefined) {
      found.push(value);
      index += 1;
    } else if (text === "-i" || text === "--replace") {
      found.push("{}");
    } else if (attached !== null) {
      found.push([attached[1], attached[2], attached[3]].find((group) => group !== undefined)!);
    }
  }
  return found.filter((placeholder) => placeholder !== "");
}

/**
 * Whether `osascript`'s arguments leave it reading its program from stdin: no `-e`, and either no script-file
 * operand or `-` as that operand, which names stdin and hands every later word to the script as its argv
 * (`osascript - one two <<'EOF'`).
 *
 * @param args the words after `osascript`
 * @returns true when stdin is the program
 */
function readsProgramFromStdin({ args }: { args: readonly string[] }): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    // A trailing `&` backgrounds the command; the segment keeps it as a word, and it is no script operand (r1 review).
    if (word === "&" || word === "--") {
      continue;
    }
    if (word === "-") {
      return true;
    }
    if (word.startsWith("-e") || !word.startsWith("-")) {
      return false;
    }
    if (OSASCRIPT_VALUED.has(word)) {
      index += 1;
    }
  }
  return true;
}

/**
 * The finding for an `osascript` that reads a browser-addressing program from a heredoc or here-string — the half
 * of the AppleScript shape that lives in a body rather than in words.
 *
 * @param segment one `commandSegments` segment, its heredoc bodies attached
 * @returns the finding, or `undefined` when no stdin program addresses a browser
 */
function stdinAppleScript({ segment }: { segment: CommandSegment }): BrowserLaunchFinding | undefined {
  const words = shellWords({ text: segment.command }).words;
  // `leadingProgram` too: `resolvePrograms` takes a `case` header for the program, hiding an arm's osascript.
  const runsFromStdin = [...programsOf({ words }), ...leadingProgram({ words })].find(
    (program) =>
      programName({ text: program[0]! }).toLowerCase() === "osascript" &&
      readsProgramFromStdin({ args: program.slice(1) }),
  );
  if (runsFromStdin === undefined) {
    return undefined;
  }
  const heredoc = stdinHeredocIndex({ command: segment.command });
  // An operator with no body yet (`osascript <<EOF` at the end of the line) attaches none: there is no program to read,
  // and dereferencing it threw, swallowing every other walk's refusal on the same line (the r2 review). A piece cut
  // at a bare `&` carries only its own operators' bodies, so the index names its own body.
  const attached = heredoc === undefined ? [] : segment.heredocs.slice(heredoc, heredoc + 1).map((body) => body.body);
  const bodies = [...hereStrings({ words }), ...attached];
  const language = osascriptLanguage({ args: runsFromStdin.slice(1) });
  if (!bodies.some((program) => appleScriptAddressesBrowser({ language, program }))) {
    return undefined;
  }
  return { invocation: runsFromStdin.join(" "), shape: "browser-applescript" };
}

/**
 * Refuse a shell line with a segment that launches or drives a browser outside the `slopweaver browser` verbs,
 * unless that segment or the environment opens {@link BROWSER_LAUNCH_OVERRIDE_ENV}.
 *
 * @param command the raw shell line
 * @param env the hook's environment, carrying the ambient hatch
 * @returns the refusal naming the browser verbs, or allow
 */
export function classifyBrowserLaunchCommand({
  command,
  env,
}: {
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): WalkVerdict {
  return classifyLine({ command, depth: 0, env });
}

/**
 * The script a shell runs from `-c` once a wrapper has been peeled off it — `sudo bash -lc '…'` reaches the judge
 * as `bash -lc '…'`, a shell `walkSegments` never descended into because `sudo` stood in front of it (the r1 review).
 *
 * @param program one program's words, its wrappers already peeled
 * @returns the script, or `undefined` when the program is not a shell running one
 */
function peeledShellScript({ program }: { program: readonly string[] }): string | undefined {
  if (!SHELL_RUNNERS.has(programName({ text: program[0]! }).toLowerCase())) {
    return undefined;
  }
  const flag = program.findIndex(
    (word, index) => index > 0 && /^-[a-z]+$/i.test(word) && word.toLowerCase().includes("c"),
  );
  if (flag === -1) {
    return undefined;
  }
  return program.slice(flag + 1).find((word) => !/^[-+]/.test(word));
}

/**
 * The program one segment runs as `./wrappedProgram.ts`'s `programAt` finds it: past a reserved word, an assignment,
 * a `case … in PATTERN)` header, `function NAME` and `coproc` — `resolvePrograms` took `case` itself for the program
 * — and with an `env -S` split string split in place as env splits it, clustered (`-iS`),
 * attached, `--split-string=` or abbreviated, behind `sudo` or another `env`.
 *
 * @param words one segment's lexed words
 * @returns the program's words, its program first, or none when the segment runs none
 */
function leadingProgram({ words }: { words: readonly ShellWord[] }): readonly (readonly string[])[] {
  const located = programAt({ words: withoutRedirections({ words }) });
  if (located.at === undefined) {
    return [];
  }
  return [located.words.slice(located.at).map((word) => word.text)];
}

/**
 * Every command line a wrapper in these words runs from an option's VALUE rather than from its argv — `env -S`,
 * `su -c`, `runuser -c`, `flock -c`, `watch`, `trap` and a package runner's `-c`/`--call` — read at each COMMAND
 * START, so a wrapper fronted by `sudo` or another `env` is seen too, while the same word as an argument (`echo trap
 * '…' DEBUG`) runs nothing.
 *
 * @param words one segment's lexed words
 * @returns each payload line, to walk again
 */
function wrapperPayloads({ words }: { words: readonly ShellWord[] }): readonly string[] {
  const bare = withoutRedirections({ words });
  return commandStarts({ words: bare }).flatMap((at) => {
    const from = bare.slice(at);
    const found = [wrapperPayload({ words: from }), runnerCallPayload({ words: from.map((word) => word.text) })];
    return found.filter((payload) => payload !== undefined);
  });
}

/**
 * The program at EVERY command start in these words, its wrappers peeled — what a wrapper runs from its argv, past
 * its own options: `watch -x open …`, `find … -exec open …`, `xargs`, a chain of them in any
 * spelling. The leading program alone missed each such wrapper this walk's own tables did not peel.
 *
 * @param words one segment's lexed words
 * @returns each program's words, its program first
 */
function startPrograms({ words }: { words: readonly ShellWord[] }): readonly (readonly string[])[] {
  const bare = withoutRedirections({ words });
  return commandStarts({ words: bare }).flatMap((at) => programsOf({ words: bare.slice(at) }));
}

/**
 * The launches one segment runs from a STRING rather than its argv — an `env -S` split string, a wrapper payload, a
 * shell's `-c` script, a `$(…)`/`<(…)` substitution — read off the segment's own words. `walkSegments` strips a leading `env` and its options before
 * its judge sees a segment, leaving `-iS '…'` with no `env` to give it meaning, so these are read here instead, and
 * each line is walked again whole.
 *
 * @param segment one `commandSegments` segment
 * @param depth how many payloads were opened on the way here, bounded by {@link MAX_PEELED_SHELLS}
 * @param env the environment the walk is judged under
 * @returns the refusal naming the browser verbs, or allow
 */
function payloadVerdict({
  depth,
  env,
  segment,
}: {
  depth: number;
  env: Readonly<Record<string, string | undefined>>;
  segment: CommandSegment;
}): WalkVerdict {
  const { words, substitutions } = shellWords({ text: segment.command });
  const split = leadingProgram({ words });
  const placeholders = xargsPlaceholders({ words });
  for (const program of [...split, ...startPrograms({ words })]) {
    const finding = browserLaunchArgv({ placeholders, words: program });
    if (finding !== undefined) {
      return refusalFor({ finding });
    }
  }
  const scripts = [...programsOf({ words }), ...split].flatMap((program) => {
    const script = peeledShellScript({ program });
    return script === undefined ? [] : [script];
  });
  // An unquoted heredoc body expands its substitutions before any program reads it, `cat` included.
  const expanded = segment.heredocs
    .filter((heredoc) => !heredoc.quoted)
    .flatMap((heredoc) => bodySubstitutions({ body: heredoc.body }));
  const stdinScripts = shellStdinScripts({ programs: [...programsOf({ words }), ...split], segment, words });
  return walkNested({
    depth,
    env,
    lines: [...scripts, ...wrapperPayloads({ words }), ...substitutions, ...expanded, ...stdinScripts],
  });
}

/**
 * Any word a launch past the reading bound would have to spell — a launching program, a browser's name, a URL or a
 * debugging flag — matched with the quotes and backslashes a nesting adds removed, so `o'p'en` still reads `open`.
 * Deliberately broad: a match costs only a refusal of a line the walk did not read.
 */
const LAUNCH_HINT =
  /open|osascript|playwright|chrom|safari|firefox|edge|brave|arc|vivaldi|opera|orion|zen|kagi|duckduckgo|browser|http|debugging|cdp/i;

/** A character spelled by its code (`$'\157pen'`, `\x6f`), which no word match can see through. */
const ENCODED_CHARACTER = /\$'|\\[0-7xXuU]/;

/**
 * Whether a line past the reading bound could launch a browser: it names something launch-like once its nesting's
 * quotes are stripped, or it spells a character by its code. A line that does neither — `git status` four shells
 * deep — is no launch.
 *
 * @param line one nested line the walk will not read
 * @returns true when refusing it unread is the safe answer
 */
function mayLaunch({ line }: { line: string }): boolean {
  return ENCODED_CHARACTER.test(line) || LAUNCH_HINT.test(line.replaceAll(/['"\\]/g, ""));
}

/**
 * Walk each line a wrapper runs from a string, one level deeper — and REFUSE a line past {@link MAX_PEELED_SHELLS}
 * that {@link mayLaunch} rather than allow it unread: a bound that allowed what it had not read let four nested
 * `bash -c` layers hide an `open -a Safari <url>`. The hatch still opens it.
 *
 * @param lines each nested line, a shell's `-c` script or a wrapper's payload
 * @param depth how many lines were opened on the way here
 * @param env the environment the walk is judged under
 * @returns the first refusal, or allow
 */
function walkNested({
  depth,
  env,
  lines,
}: {
  depth: number;
  env: Readonly<Record<string, string | undefined>>;
  lines: readonly string[];
}): WalkVerdict {
  for (const line of lines) {
    if (depth >= MAX_PEELED_SHELLS) {
      if (mayLaunch({ line })) {
        return refusalFor({ finding: { invocation: line, shape: "nested-past-reading" } });
      }
      continue;
    }
    const inner = classifyLine({ command: line, depth: depth + 1, env });
    if (inner.blocked) {
      return inner;
    }
  }
  return { blocked: false };
}

/**
 * One segment cut at each bare `&`, every piece a command list of its own: `true & open -a Safari <url>` runs the
 * `open`, which neither segmenter splits off. Each piece carries only the heredoc bodies its own
 * operators opened, in source order: `cat <<'DATA' & osascript <<'SCRIPT'` hands `DATA` to `cat` alone, so a
 * browser named in data never reads as the `osascript` program.
 *
 * @param segment one `commandSegments` segment
 * @returns its pieces, or the segment itself when it holds no bare `&`
 */
function backgroundPieces({ segment }: { segment: CommandSegment }): readonly CommandSegment[] {
  const cuts = [...shellWords({ text: segment.command }).ampersands, segment.command.length];
  let taken = 0;
  return cuts
    .map((cut, at) => {
      const command = segment.command.slice(at === 0 ? 0 : cuts[at - 1]! + 1, cut);
      const count = heredocOperatorCount({ command });
      const heredocs = segment.heredocs.slice(taken, taken + count);
      taken += count;
      return { ...segment, command, heredocs };
    })
    .filter((piece) => piece.command.trim() !== "");
}

/**
 * Judge one command list: a stdin AppleScript, a payload read from a string, then `walkSegments` over its words.
 *
 * @param segment one segment, or one piece of one cut at a bare `&`
 * @param depth how many lines were opened on the way here
 * @param env the environment the walk is judged under
 * @returns the refusal naming the browser verbs, or allow
 */
function classifySegment({
  depth,
  env,
  segment,
}: {
  depth: number;
  env: Readonly<Record<string, string | undefined>>;
  segment: CommandSegment;
}): WalkVerdict {
  const fromStdin = stdinAppleScript({ segment });
  if (fromStdin !== undefined) {
    return refusalFor({ finding: fromStdin });
  }
  const fromPayload = payloadVerdict({ depth, env, segment });
  if (fromPayload.blocked) {
    return fromPayload;
  }
  return walkSegments({
    command: segment.command,
    env,
    judge: ({ tokens, env: segmentEnv }) => {
      if (segmentEnv[BROWSER_LAUNCH_OVERRIDE_ENV] === "1") {
        return { blocked: false };
      }
      const words = shellWords({ text: tokens.join(" ") }).words;
      const scripts: string[] = [];
      const placeholders = xargsPlaceholders({ words });
      for (const program of programsOf({ words })) {
        const finding = browserLaunchArgv({ placeholders, words: program });
        if (finding !== undefined) {
          return refusalFor({ finding });
        }
        const script = peeledShellScript({ program });
        if (script !== undefined) {
          scripts.push(script);
        }
      }
      return walkNested({ depth, env: segmentEnv, lines: scripts });
    },
    overrideEnv: BROWSER_LAUNCH_OVERRIDE_ENV,
  });
}

/**
 * The recursive half of {@link classifyBrowserLaunchCommand}.
 *
 * @param command the shell line, or a peeled shell's `-c` script
 * @param depth how many peeled shells were opened on the way here, bounded by {@link MAX_PEELED_SHELLS}
 * @returns the refusal naming the browser verbs, or allow
 */
function classifyLine({
  command,
  depth,
  env,
}: {
  command: string;
  depth: number;
  env: Readonly<Record<string, string | undefined>>;
}): WalkVerdict {
  for (const [segmentIndex, segment] of commandSegments({ command }).entries()) {
    const segmentOpen =
      env[BROWSER_LAUNCH_OVERRIDE_ENV] === "1" ||
      hasCommandSegmentOverride({ command, name: BROWSER_LAUNCH_OVERRIDE_ENV, segmentIndex });
    const closed = closedPieces({ pieces: backgroundPieces({ segment }), segmentOpen });
    for (const piece of closed) {
      const verdict = classifySegment({ depth, env, segment: piece });
      if (verdict.blocked) {
        return verdict;
      }
    }
  }
  return { blocked: false };
}

/**
 * The pieces of one segment its hatch leaves closed. A `NAME=1` prefix scopes to its own command, so it opens the
 * first piece of a bare-`&` list and no later one; a segment open while its first piece carries no
 * prefix is open by an earlier `export` or the environment, which reaches every piece.
 *
 * @param pieces the segment cut at each bare `&`
 * @param segmentOpen whether the hatch opens the segment as a whole
 * @returns the pieces still to walk
 */
function closedPieces({
  pieces,
  segmentOpen,
}: {
  pieces: readonly CommandSegment[];
  segmentOpen: boolean;
}): readonly CommandSegment[] {
  const name = BROWSER_LAUNCH_OVERRIDE_ENV;
  const prefixed = pieces.map((piece) => hasInlineEnvironmentOverride({ command: piece.command, name }));
  const inherited = segmentOpen && prefixed[0] !== true;
  if (inherited) {
    return [];
  }
  return pieces.filter((_piece, at) => (at === 0 ? !segmentOpen : !prefixed[at]));
}
