/**
 * The pure argv half of the browser-launch walk (`./browserLaunchCommand.ts`): given the words one simple command
 * runs, its program first and every wrapper already peeled, say whether it launches or drives a browser outside
 * the `slopweaver browser` verbs. Four shapes, measured passing the hook:
 *
 * - **`open`** with `-a`/`-b` naming a browser, with or without a URL, or `open <http(s) URL>` into the default one;
 * - **the Playwright CLIs** — `@playwright/cli`/`playwright-cli` and `@playwright/mcp` at all, `playwright` on a
 *   launching subcommand or with `--extension`/`--cdp` — bare or behind `npx`, `bunx`, `pnpm dlx`, `yarn dlx`/`exec`;
 * - **a browser binary run directly**, a remote-debugging flag included, anything but `--version`/`--help`;
 * - **`osascript -e`** whose program tells a browser application what to do.
 *
 * A heredoc `osascript` reads is the classifier's, which can see bodies; this module sees words only. What an
 * AppleScript or JXA program addresses is `./browserAppleScript.ts`'s.
 */
import { posix } from "node:path";

import { appleScriptAddressesBrowser, osascriptInlineProgram } from "./browserAppleScript.js";
import { isBrowserApplication, isBrowserBundleId, isBrowserExecutable } from "./browserApplication.js";
import { packageName, runnerTargets } from "./packageRunnerTargets.js";
import { programName } from "./pythonWrappers.js";
import { osascriptLanguage } from "./scriptComments.js";

/**
 * Which of the four launch shapes a finding is — or `nested-past-reading`, the classifier's refusal of a line nested
 * deeper than it reads, since a bound that allowed what it had not read was a bypass.
 */
type BrowserLaunchShape =
  "macos-open" | "playwright-cli" | "browser-binary" | "browser-applescript" | "nested-past-reading";

/** One recognised launch: its shape, and the words a refusal names it by. */
export interface BrowserLaunchFinding {
  readonly shape: BrowserLaunchShape;
  readonly invocation: string;
}

/** Playwright packages and bins that exist only to drive a browser: any real invocation is a launch. */
const DRIVING_PLAYWRIGHT: ReadonlySet<string> = new Set([
  "@playwright/cli",
  "@playwright/mcp",
  "playwright-cli",
  "playwright-mcp",
]);

/** Playwright packages and bins with non-launching subcommands (`install`) beside launching ones. */
const GENERAL_PLAYWRIGHT: ReadonlySet<string> = new Set(["@playwright/test", "playwright", "playwright-core"]);

/**
 * `playwright` subcommands that open no browser — they fetch, remove or merge files, or print. Every other subcommand
 * is read as a launch: a list of the launching ones missed `launch-server`, and a new Playwright
 * subcommand is likelier to drive a browser than not, so an unknown one costs a refusal rather than a launch.
 */
const NON_LAUNCHING_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "clear-cache",
  "help",
  "install",
  "install-deps",
  "merge-reports",
  "uninstall",
  "version",
]);

/** JavaScript runtimes that run a Playwright CLI handed to them as its entry file. */
const JS_RUNTIMES: ReadonlySet<string> = new Set(["bun", "node", "nodejs"]);

/**
 * Any script file inside a Playwright package — its CLI entry is `cli.js` in one and `playwright-cli.js` in another
 *, so no entry-file name is listed — or its `node_modules/.bin` shim, as a runtime is handed it:
 * the package name is group 1 or group 2. Only an installed package is one: a script under a folder that merely shares
 * the name (`/tmp/playwright/report.js`) is not. Tested against the NORMALISED path, so a doubled
 * slash or a `.` segment is the file the kernel opens, and with no extension, since Node resolves
 * `…/playwright/cli` to `cli.js`.
 */
const PLAYWRIGHT_ENTRY =
  /(?:^|\/)node_modules\/(@playwright\/(?:test|cli|mcp)|playwright(?:-core)?)\/(?:[^/]+\/)*[^/]+$|(?:^|\/)node_modules\/\.bin\/(playwright(?:-core|-cli|-mcp)?)(?:\.[cm]?js)?$/i;

/** Node and Bun options that take the next word as their value, so it is never the script operand. */
const RUNTIME_VALUED_OPTIONS: ReadonlySet<string> = new Set([
  "--conditions",
  "--env-file",
  "--experimental-loader",
  "--import",
  "--loader",
  "--preload",
  "--require",
  "-C",
  "-r",
]);

/** Node and Bun options whose value IS the program, so no script operand follows. */
const RUNTIME_INLINE_OPTIONS: ReadonlySet<string> = new Set(["--eval", "--print", "-e", "-p"]);

/**
 * Where a JavaScript runtime's script operand sits: the first word that is neither an option nor an option's value,
 * past a `bun run`.
 *
 * @param words the command's words, the runtime first
 * @returns its index, or `undefined` when the program is inline (`-e`) or absent
 */
function runtimeScriptOperand({ words }: { words: readonly string[] }): number | undefined {
  // `run` is skipped as the first operand wherever it sits: a valueless flag may come first (`bun --smol run …`).
  // A `node run` running a file called `run` is read past too — the fail-closed direction.
  let skippedRun = false;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]!;
    if (RUNTIME_INLINE_OPTIONS.has(word)) {
      return undefined;
    }
    if (RUNTIME_VALUED_OPTIONS.has(word)) {
      index += 1;
    } else if (word === "--") {
      return index + 1 < words.length ? index + 1 : undefined;
    } else if (word === "run" && !skippedRun) {
      skippedRun = true;
    } else if (!word.startsWith("-")) {
      return index;
    }
  }
  return undefined;
}

/** Flags that attach any Playwright CLI to a running browser. */
const ATTACH_FLAGS: readonly string[] = ["--extension", "--cdp"];

/** Arguments that only print, so a browser tool given nothing else launches nothing. */
const INERT_ARGUMENTS: ReadonlySet<string> = new Set(["--help", "-h", "--version", "-v", "-V", "help", "version"]);

/**
 * The one flag a browser binary run directly answers by printing and exiting. Narrower than {@link INERT_ARGUMENTS}:
 * Chromium reads a bare `version` or `help` as a URL to open, and ignores a short flag it does not know, so either
 * launches the browser.
 */
const BINARY_PRINT_FLAGS: ReadonlySet<string> = new Set(["--version"]);

/** Flags a Playwright CLI answers by printing and exiting, wherever they sit among its arguments. */
const PRINT_AND_EXIT_FLAGS: ReadonlySet<string> = new Set(["--help", "-h", "--version", "-V"]);

/**
 * The Playwright CLI a command runs, as a package name and the arguments after it — bare (`playwright open`) or
 * behind a package runner.
 *
 * @param words the command's words
 * @returns the CLI and its arguments, or `undefined` when no Playwright CLI runs
 */
function playwrightCli({
  words: written,
}: {
  words: readonly string[];
}): { name: string; args: readonly string[] } | undefined {
  // `corepack yarn dlx …` runs the manager it names, so read the manager (the r3 review).
  const fronted = written.length > 1 && programName({ text: written[0]! }).toLowerCase() === "corepack";
  const words = fronted ? written.slice(1) : written;
  const bare = packageName({ text: programName({ text: words[0]! }) });
  if (DRIVING_PLAYWRIGHT.has(bare) || GENERAL_PLAYWRIGHT.has(bare)) {
    return { args: words.slice(1), name: bare };
  }
  // `node ./node_modules/playwright/cli.js test` runs the same CLI through its entry file.
  // Only the runtime's own script operand is read: a later word is that script's argument.
  if (JS_RUNTIMES.has(bare.toLowerCase())) {
    const at = runtimeScriptOperand({ words });
    const entry = at === undefined ? null : PLAYWRIGHT_ENTRY.exec(posix.normalize(words[at]!));
    if (at !== undefined && entry !== null) {
      return {
        args: words.slice(at + 1),
        name: [entry[1], entry[2]].find((group) => group !== undefined)!.toLowerCase(),
      };
    }
  }
  const clis = runnerTargets({ words })
    .filter((target) => DRIVING_PLAYWRIGHT.has(target.name) || GENERAL_PLAYWRIGHT.has(target.name))
    .map((target) => ({ args: words.slice(target.at + 1), name: target.name }));
  // A launch under either reading of an unknown option is the one judged.
  const launching = clis.find((cli) => playwrightLaunches(cli));
  if (launching !== undefined) {
    return launching;
  }
  return clis[0];
}

/**
 * Whether a Playwright CLI's arguments launch or attach to a browser.
 *
 * @param name the CLI's package name
 * @param args the arguments after it
 * @returns true for a launch
 */
function playwrightLaunches({ name, args }: { name: string; args: readonly string[] }): boolean {
  // A word after `--` is an operand, never a flag: `playwright test -- --help` runs the tests.
  const terminator = args.indexOf("--");
  const options = terminator === -1 ? args : args.slice(0, terminator);
  // `playwright test --help` and `@playwright/cli -s=x --version` print and exit before anything launches (r3 review).
  if (options.some((arg) => PRINT_AND_EXIT_FLAGS.has(arg))) {
    return false;
  }
  // An attach flag is a flag only before `--`, too.
  const attaches = options.some((arg) => ATTACH_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
  if (attaches) {
    return true;
  }
  if (DRIVING_PLAYWRIGHT.has(name)) {
    // A bare `playwright-cli` prints its help; a bare `@playwright/mcp` starts the server, which IS the launch.
    const bareStartsServer = args.length === 0 && name.endsWith("mcp");
    // `install` fetches browsers or skill files and opens neither (the r3 review: `@playwright/cli install --skills`).
    const installs = options.find((arg) => !arg.startsWith("-")) === "install";
    return bareStartsServer || (!installs && !args.every((arg) => INERT_ARGUMENTS.has(arg)));
  }
  // The subcommand is read before `--` only: `playwright -- help` hands `help` on as an operand, which this walk
  // cannot read as harmless, so an operand after `--` with no subcommand before it fails closed.
  const subcommand = options.find((arg) => !arg.startsWith("-"));
  const operandsOnly = subcommand === undefined && terminator !== -1 && terminator < args.length - 1;
  // `playwright test --list` collects and prints the tests and runs none, so no browser opens.
  const listsOnly = subcommand === "test" && options.includes("--list");
  return operandsOnly || (subcommand !== undefined && !NON_LAUNCHING_SUBCOMMANDS.has(subcommand) && !listsOnly);
}

/** macOS `open` options that take the next word as their value. */
const OPEN_VALUED: ReadonlySet<string> = new Set(["--env", "--stderr", "--stdin", "--stdout", "-s"]);

/** A URL `open` hands to the default browser. */
const WEB_URL = /^https?:\/\//i;

/** The lists an `open` cluster's valued letters land in. */
interface OpenLists {
  readonly a: string[];
  readonly b: string[];
  readonly u: string[];
}

/** `open`'s valued short letters, each with the list its value lands in; `-s` (an SDK) lands in none. */
const OPEN_VALUED_LETTERS: ReadonlyMap<string, keyof OpenLists | undefined> = new Map([
  ["a", "a"],
  ["b", "b"],
  ["s", undefined],
  ["u", "u"],
]);

/** `open`'s short letters that name an editor as the application: `-e` TextEdit, `-t` the default text editor. */
const OPEN_EDITOR_LETTERS: ReadonlySet<string> = new Set(["e", "t"]);

/**
 * Read one `open` short-flag cluster into the application, bundle and target lists, as getopt reads it: a valued
 * letter takes the rest of the cluster when any is left (`-aSafari`, `-bcom.apple.Safari`) and
 * otherwise the next word (`-na "Google Chrome"`, `-gb com.apple.Safari`); `-e` is TextEdit and `-t` the default text
 * editor, an application named and never a browser (the r3 review).
 *
 * @param into the lists an `-a`, `-b` or `-u` value lands in
 * @param value the word after the cluster, when there is one
 * @param word the cluster itself
 * @returns how many extra words the cluster consumed, 0 or 1
 */
function readOpenFlagCluster({
  into,
  value,
  word,
}: {
  into: OpenLists;
  value: string | undefined;
  word: string;
}): number {
  for (let at = 1; at < word.length; at += 1) {
    const letter = word[at]!;
    if (OPEN_EDITOR_LETTERS.has(letter)) {
      into.a.push("TextEdit");
    }
    if (OPEN_VALUED_LETTERS.has(letter)) {
      return takeOpenValue({ attached: word.slice(at + 1), into, lands: OPEN_VALUED_LETTERS.get(letter), value });
    }
  }
  return 0;
}

/**
 * Land one valued `open` letter's value — the rest of its cluster, else the next word — in its list.
 *
 * @param attached the rest of the cluster after the letter, empty when none is left
 * @param into the lists a value lands in
 * @param lands which list this letter's value lands in, or none for `-s`
 * @param value the word after the cluster, when there is one
 * @returns 1 when the next word was taken as the value, else 0
 */
function takeOpenValue({
  attached,
  into,
  lands,
  value,
}: {
  attached: string;
  into: OpenLists;
  lands: keyof OpenLists | undefined;
  value: string | undefined;
}): number {
  const taken = attached === "" ? value : attached;
  if (taken !== undefined && lands !== undefined) {
    into[lands].push(taken);
  }
  return attached === "" && value !== undefined ? 1 : 0;
}

/**
 * Whether a macOS `open` command opens a browser: an `-a`/`-b` naming one, or — with no application named — an
 * http(s) operand or `-u` value, which goes to the default browser — or one naming nothing, whose operands arrive
 * at run time. Words after `--args` are the launched app's.
 *
 * @param args the words after `open`
 * @param placeholders the `xargs` replacement strings on the line, each standing for a word supplied at run time
 * @returns true for a browser launch
 */
function openLaunchesBrowser({
  args,
  placeholders,
}: {
  args: readonly string[];
  placeholders: readonly string[];
}): boolean {
  const applications: string[] = [];
  const bundles: string[] = [];
  const targets: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if (word === "--args") break;
    if (OPEN_VALUED.has(word)) {
      index += 1;
    } else if (/^-[A-Za-z]/.test(word)) {
      index += readOpenFlagCluster({ into: { a: applications, b: bundles, u: targets }, value: args[index + 1], word });
    } else if (!word.startsWith("-")) {
      targets.push(word);
    }
  }
  // An `open` naming nothing to open takes its operands at run time — `printf Safari | xargs open -a` — or does
  // nothing, so it fails closed, as does a word carrying an `xargs` replacement string — `{}` or whatever `-I`/`-J`
  // named (`xargs -I % open -a %`) — since that word is supplied at run time.
  const named = [...applications, ...bundles, ...targets];
  const asksForHelp = args.some((arg) => arg === "-h" || arg === "--help");
  const runtimeSupplied = named.some(
    (word) => word.includes("{}") || placeholders.some((placeholder) => word.includes(placeholder)),
  );
  if (!asksForHelp && (named.length === 0 || runtimeSupplied)) {
    return true;
  }
  if (applications.length > 0 || bundles.length > 0) {
    return (
      applications.some((text) => isBrowserApplication({ text })) || bundles.some((text) => isBrowserBundleId({ text }))
    );
  }
  return targets.some((target) => WEB_URL.test(target));
}

/**
 * The words a refusal names a launch by, cut short so a long command does not swamp the first line.
 *
 * @param words the command's words
 * @returns the invocation, at most 120 characters
 */
function invocationOf({ words }: { words: readonly string[] }): string {
  const joined = words.join(" ");
  return joined.length <= 120 ? joined : `${joined.slice(0, 117)}...`;
}

/**
 * Whether one command's words launch or drive a browser outside the `slopweaver browser` verbs.
 *
 * @param words the command's words with quoting removed, the program first and every wrapper already peeled
 * @param placeholders every replacement string an `xargs` on the same line substitutes at run time (`-I %`)
 * @returns the finding, or `undefined` when the command launches no browser
 */
export function browserLaunchArgv({
  placeholders,
  words,
}: {
  placeholders: readonly string[];
  words: readonly string[];
}): BrowserLaunchFinding | undefined {
  const program = words[0];
  if (program === undefined) {
    return undefined;
  }
  const args = words.slice(1);
  // macOS resolves a path case-insensitively, so `/usr/bin/Open` runs `open`.
  const name = programName({ text: program }).toLowerCase();
  const invocation = invocationOf({ words });
  if (name === "open" && openLaunchesBrowser({ args, placeholders })) {
    return { invocation, shape: "macos-open" };
  }
  const onlyPrints = args.length > 0 && args.every((arg) => BINARY_PRINT_FLAGS.has(arg));
  if (isBrowserExecutable({ program }) && !onlyPrints) {
    return { invocation, shape: "browser-binary" };
  }
  if (name === "osascript") {
    const inline = osascriptInlineProgram({ args });
    return inline !== undefined &&
      appleScriptAddressesBrowser({ language: osascriptLanguage({ args }), program: inline })
      ? { invocation, shape: "browser-applescript" }
      : undefined;
  }
  const cli = playwrightCli({ words });
  if (cli !== undefined && playwrightLaunches(cli)) {
    return { invocation, shape: "playwright-cli" };
  }
  return undefined;
}
