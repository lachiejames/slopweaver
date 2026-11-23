/**
 * `slopweaver atlas jumpcloud auth-events --since <iso> [--until <iso>] [--max-pages <n>] [--json]` —
 * a bounded live read of Directory Insights authentication events, folded to one last-auth per identity,
 * with nothing written anywhere.
 *
 * The verb is deliberately thin, like `sync` beside it: the window parse, the credential lookup and the
 * rendering are here, and every decision worth reviewing is in `src/atlas/jumpcloud/authEvents.ts` and
 * `src/atlas/jumpcloud/authWindow.ts`, which are pure. What this verb is FOR — and why reading a family the
 * owner's rule bans STORING is outside that ban rather than a hole in it — is the first file's header.
 *
 * A caller reading "nobody authenticated" from this output is reading a bounded claim, so the bound is
 * printed beside the rows rather than left to be inferred: the window asked for, the oldest instant the
 * walk actually reached, and whether a page cap truncated it.
 */
import {
  type AuthEventsReport,
  productionAuthEventsDeps,
  readJumpcloudAuthEvents,
  type ServiceWalk,
} from "../../../../atlas/jumpcloud/authEventsRead.js";
import { resolveAuthWindow } from "../../../../atlas/jumpcloud/authWindow.js";
import { slopweaverHome } from "../../../../homeDir.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, positiveIntFlag, verbTail } from "../../../optionParsers.js";

/** Where a JumpCloud verb sits: past the runtime, the script, the `atlas` noun and the `jumpcloud` platform. */
const JUMPCLOUD_VERB_INDEX = 4;

/**
 * How many pages ONE SERVICE may spend when the caller names no ceiling.
 *
 * 400 pages of 1,000 events is 400,000 authentications per service, comfortably above what a full 90-day window
 * of a mid-sized organisation's `systems` traffic measured at (a few hundred pages), and it bounds a
 * mistyped window rather than letting it run to whatever the provider would serve.
 */
const DEFAULT_MAX_PAGES = 400;

/**

 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const JUMPCLOUD_AUTH_EVENTS_USAGE =
  "usage: slopweaver atlas jumpcloud auth-events --since <iso> [--until <iso>] [--max-pages <n>] [--json] [--home <dir>]";

/**
 * Run the `atlas jumpcloud auth-events` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runJumpcloudAuthEvents(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: JUMPCLOUD_VERB_INDEX, verbs: ["auth-events"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: JUMPCLOUD_AUTH_EVENTS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "max-pages", "since", "until"] } });
  if (parsed.isErr()) {
    return reportUsage({ errors: parsed.error });
  }
  const { values, flags } = parsed.value;
  const problems: string[] = [];
  const maxPages = positiveIntFlag({ fallback: DEFAULT_MAX_PAGES, name: "max-pages", problems, values });
  const window = resolveAuthWindow({
    nowIso: new Date().toISOString(),
    since: values["since"],
    until: values["until"],
  });
  if (window.isErr()) {
    return reportUsage({ errors: [...problems, window.error.message] });
  }
  if (problems.length > 0) {
    return reportUsage({ errors: problems });
  }
  return runWindow({ flags, home: homeFrom({ values }), maxPages, window: window.value });
}

/**
 * The state home this read uses: the caller's, or the install's own.
 *
 * @param values the parsed flag values
 * @returns the home directory
 */
function homeFrom({ values }: { values: Readonly<Record<string, string>> }): string {
  const flag = values["home"];
  if (flag === undefined) {
    return slopweaverHome();
  }
  return flag;
}

/** Print every usage problem plus the usage line, and return the usage exit code. */
function reportUsage({ errors }: { errors: readonly string[] }): number {
  errors.forEach((error) => {
    logger.error({ msg: error });
  });
  logger.error({ msg: JUMPCLOUD_AUTH_EVENTS_USAGE });
  return EXIT_USAGE;
}

/**
 * Resolve the credential, perform the read, and report it.
 *
 * Split from {@link runJumpcloudAuthEvents} under the line cap, and the seam is the one that file already
 * wants: the caller decides WHAT was asked for, and this performs it.
 *
 * @param window the resolved window
 * @param maxPages the per-service page ceiling
 * @param home the state home
 * @param flags the boolean flags this invocation carried
 * @returns the process exit code
 */
async function runWindow({
  window,
  maxPages,
  home,
  flags,
}: {
  window: { readonly startIso: string; readonly endIso: string };
  maxPages: number;
  home: string;
  flags: ReadonlySet<string>;
}): Promise<number> {
  const deps = productionAuthEventsDeps({
    env: process.env,
    home,
    maxPages,
    // stderr, so `--json` stdout stays one parseable document.
    progress: (line) => process.stderr.write(`jumpcloud auth-events: ${line}\n`),
  });
  if (deps.isErr()) {
    deps.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  const report = await readJumpcloudAuthEvents({
    deps: deps.value,
    endIso: window.endIso,
    startIso: window.startIso,
  });
  if (report.isErr()) {
    logger.error({ msg: report.error.message });
    return EXIT_ERROR;
  }
  return reportAuthEvents({ json: flags.has("json"), report: report.value });
}
/**
 * Print one read and decide the exit code.
 *
 * The bound lines are not decoration: an identity missing from the rows is silent only back to
 * `oldestEventIso`, and a `page-cap` ending on any service says that service never reached the start of
 * the window at all. Both go to stderr, so `--json` and the plain rows stay pipeable.
 *
 * @param report what every service's walk folded and what stopped each
 * @param json whether the caller asked for the machine-readable form
 * @returns the process exit code
 * @internal
 */
export function reportAuthEvents({ report, json }: { report: AuthEventsReport; json: boolean }): number {
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
    return EXIT_OK;
  }
  for (const row of report.fold.lastAuth) {
    logger.out({ line: `${row.lastAuthIso}\t${row.identity}\t${row.identityKind}\t${row.service}\t${row.eventType}` });
  }
  const pages = report.services.reduce((total, walk) => total + walk.pagesRead, 0);
  logger.error({
    msg: `window ${report.startIso} → ${report.endIso}: ${String(report.fold.eventsRead)} event(s) over ${String(pages)} page(s), ${String(report.fold.lastAuth.length)} identity(ies) authenticated`,
  });
  logger.error({ msg: `oldest instant reached: ${oldestReached({ report })}` });
  for (const walk of report.services) {
    logger.error({
      msg: `${walk.service}: ${String(walk.eventsRead)} event(s) over ${String(walk.pagesRead)} page(s) — ${describeAuthWalkEnding({ walk })}`,
    });
  }
  if (report.fold.unrecognisedEventTypes.length > 0) {
    logger.error({
      msg: `event types read and not counted as an authentication: ${report.fold.unrecognisedEventTypes.join(", ")}`,
    });
  }
  return EXIT_OK;
}

/**
 * One clause saying what stopped a service's walk, and what a reader may conclude from a silence in it.
 *
 * @param walk one service's completed walk
 * @returns the clause
 * @internal
 */
export function describeAuthWalkEnding({ walk }: { walk: ServiceWalk }): string {
  switch (walk.ending.kind) {
    case "window-exhausted": {
      return "reached the start of the window, so an identity absent above did not authenticate on it";
    }
    case "no-cursor": {
      return "the provider offered no further cursor, so a silence on this service holds only back to the oldest instant named";
    }
    case "page-cap": {
      return `the ${String(walk.ending.pages)}-page ceiling stopped it short, so a silence on this service holds only back to the oldest instant named — raise it with --max-pages`;
    }
    default: {
      const exhaustive: never = walk.ending;
      return exhaustive;
    }
  }
}

export const jumpcloudAuthEventsCommand = defineCommand({ run: runJumpcloudAuthEvents });

/**
 * The oldest instant a read actually reached, as a reader sees it.
 *
 * A named function rather than a conditional expression: the lint bar prefers `??` over a ternary and
 * `no-silent-fallback` forbids `??`, so the shape both rules accept is an `if` that names the absent case.
 *
 * @param report the completed read
 * @returns the instant, or the sentence for a read that reached nothing
 */
function oldestReached({ report }: { report: AuthEventsReport }): string {
  const oldest = report.fold.oldestEventIso;
  if (oldest === null) {
    return "nothing was read";
  }
  return oldest;
}
