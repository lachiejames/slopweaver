/**
 * `slopweaver perf console` — the console profiled across every page and flow, in a LAUNCHED browser.
 *
 * Tens of milliseconds can still be meaningful and hundreds certainly are. This verb is how a number
 * like that is taken rather than felt: every fixed console route loaded cold, every sidebar item and in-page flow
 * (a detail page included) clicked warm, the heap across a walk, and each read behind the tiles timed alone. The walk is `src/consoleProfile/drive.ts`;
 * the tables and the budgets are pure, beside it.
 *
 * Each run is kept under `$SLOPWEAVER_HOME/perf/console/<instant>/` as `report.json` and `report.md`, so a fix is
 * judged against the run before it rather than against memory.
 */
import { join } from "node:path";

import { budgetBreaches } from "../../../consoleProfile/budget.js";
import { driveConsoleProfile } from "../../../consoleProfile/drive.js";
import { reportLines } from "../../../consoleProfile/render.js";
import { refusedReads } from "../../../consoleProfile/report.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, type ParsedFlags, parseFlags, stringFlagOr } from "../../parseFlags.js";

export const PERF_CONSOLE_USAGE =
  "usage: slopweaver perf console [--base <url>] [--runs <n>] [--only <path,...>] [--headed] [--skip-verbs]\n" +
  "                               [--check] [--json] [--home <dir>]\n" +
  "  Profile the console in a LAUNCHED Chromium (Playwright's own build, a throwaway profile — never your Chrome):\n" +
  "  every fixed route loaded cold in a fresh context (TTFB, first paint, drawn, fully loaded, loading shown, JS,\n" +
  "  heap, DOM, blocking), every sidebar item and in-page flow — a detail page is opened by one — clicked warm\n" +
  "  (visible response, drawn, fully loaded,\n" +
  "  whether the router had prefetched it), the heap across three sidebar round trips, and each live read timed\n" +
  "  alone with the launcher's own start-up beside it. Point it at a PRODUCTION build (`scripts/docs-site.sh\n" +
  "  --serve`); a dev server measures its compiler. Cells are the median of --runs (default 3) with the worst in\n" +
  "  brackets; the run is kept under $SLOPWEAVER_HOME/perf/console/<instant>/. --check exits 1 when any median\n" +
  "  is over its named budget (src/consoleProfile/budget.ts). --only narrows the walk to the paths named.";

/** Where this verb's own flags start in `process.argv`. */
const CONSOLE_ARG_OFFSET = 4;

/** The owner's own console, which `scripts/docs-site.sh --serve` binds by default. */
const DEFAULT_BASE = "http://localhost:3000";

/** Enough runs that a median means something, few enough that a walk stays a thing to run on every fix. */
const DEFAULT_RUNS = 3;

const CONSOLE_STRING_FLAGS = ["base", "home", "only", "runs"] as const;
const CONSOLE_BOOLEAN_FLAGS = ["check", "headed", "json", "skip-verbs"] as const;

const CONSOLE_FLAGS: FlagSpec = {
  boolean: [...CONSOLE_BOOLEAN_FLAGS],
  string: [...CONSOLE_STRING_FLAGS],
};

/** `--`-prefixed, for the help-truth ratchet. */
export const PERF_CONSOLE_FLAG_NAMES: readonly string[] = [...CONSOLE_STRING_FLAGS, ...CONSOLE_BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `perf console`'s flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parsePerfConsoleArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: CONSOLE_FLAGS });
}

/**
 * `--runs` as a positive whole number, or the reason it is not one.
 *
 * @param parsed the parsed flags
 * @returns the run count, or the sentence refusing it
 */
export function runsOf({ parsed }: { parsed: ParsedFlags }): Result<number> {
  const raw = stringFlagOr({ fallback: String(DEFAULT_RUNS), name: "runs", parsed });
  const runs = Number(raw);
  if (!Number.isSafeInteger(runs) || runs <= 0) {
    return err([`perf console: --runs ${raw} is not a positive whole number`]);
  }
  return ok(runs);
}

/**
 * `--only` as the list of paths it names, or `undefined` for the whole console.
 *
 * @param parsed the parsed flags
 * @returns the paths, each with its leading slash
 */
export function onlyOf({ parsed }: { parsed: ParsedFlags }): readonly string[] | undefined {
  const raw = parsed.values["only"];
  if (typeof raw !== "string") {
    return undefined;
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => (part.startsWith("/") ? part : `/${part}`));
}

/**
 * The directory one run is kept in: its instant, with the characters a path cannot carry replaced.
 *
 * @param home the slopweaver home
 * @param measuredAtIso when the run was taken
 * @returns the directory
 */
export function runDirectoryOf({ home, measuredAtIso }: { home: string; measuredAtIso: string }): string {
  return join(stateHomePaths({ home }).perfConsole, measuredAtIso.replace(/[:.]/gu, "-"));
}

/**
 * Run `slopweaver perf console`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runPerfConsole(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(CONSOLE_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PERF_CONSOLE_USAGE });
    return EXIT_OK;
  }
  const parsed = parsePerfConsoleArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: PERF_CONSOLE_USAGE });
    return EXIT_USAGE;
  }
  const runs = runsOf({ parsed: parsed.value });
  if (runs.isErr()) {
    runs.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_USAGE;
  }
  const base = stringFlagOr({ fallback: DEFAULT_BASE, name: "base", parsed: parsed.value }).replace(/\/+$/u, "");
  const homeFlag = parsed.value.values["home"];
  const home = resolveHome({ named: typeof homeFlag === "string" ? homeFlag : undefined });
  const json = parsed.value.values["json"] === true;
  const walked = await driveConsoleProfile({
    base,
    headed: parsed.value.values["headed"] === true,
    only: onlyOf({ parsed: parsed.value }),
    progress: (line) => {
      logger.error({ msg: `perf console: ${line}` });
    },
    runs: runs.value,
    verbs: parsed.value.values["skip-verbs"] !== true,
  });
  if (walked.isErr()) {
    logger.error({ msg: walked.error.message });
    return EXIT_ERROR;
  }
  const report = walked.value;
  const lines = reportLines({ report });
  const directory = runDirectoryOf({ home, measuredAtIso: report.measuredAtIso });
  writeFileAtomic({ contents: `${JSON.stringify(report, null, 2)}\n`, path: join(directory, "report.json") });
  writeFileAtomic({ contents: `${lines.join("\n")}\n`, path: join(directory, "report.md") });
  if (json) {
    logger.out({ line: JSON.stringify({ ...report, breaches: budgetBreaches({ report }), keptIn: directory }) });
  } else {
    for (const line of lines) {
      logger.out({ line });
    }
    logger.out({ line: `\nKept in ${directory}` });
  }
  const judged = budgetBreaches({ report }).length > 0 || refusedReads({ report }).length > 0;
  if (parsed.value.values["check"] === true && judged) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

export const perfConsoleCommand = defineCommand({ run: runPerfConsole });
