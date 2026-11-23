/**
 * `slopweaver fleet landed` — what landed on main, each change beside the words of their that asked for it and the
 * proof it carried (`../../../fleet/landed.ts`). The console's Fleet page reads `--json` for its Past view.
 *
 * Reads git, the PR ledger, the board and the autonomy register, and nothing else: no fetch, no network, no model.
 */
import { autonomyLedgerPort } from "../../../autonomy/port.js";
import type { LandedError } from "../../../fleet/landedErrors.js";
import { DEFAULT_LANDED_REFS } from "../../../fleet/landedGit.js";
import { readLandedReport } from "../../../fleet/landedRead.js";
import type { LandedReport } from "../../../fleet/landedTypes.js";
import { landedWordsLine } from "../../../fleet/landedWords.js";
import { slopweaverHome } from "../../../homeDir.js";
import { runningCheckoutRoot } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";

/** The flags `fleet landed` accepts, and the ONLY place they are named. */
const LANDED_FLAG_SPEC = { boolean: ["json"], string: ["dir", "home", "limit", "ref"] } as const;

/** Where a verb's own arguments start in `process.argv`: `[node, cli, fleet, landed, …]`. */
const VERB_ARG_OFFSET = 4;

/** Landings read when `--limit` is not given — the window the console draws. */
export const DEFAULT_LANDED_LIMIT = 30;
/** The most a caller may ask for: each one costs a row read, and the page folds past ten. */
const MAX_LANDED_LIMIT = 100;

/**
 * Every flag `fleet landed` advertises, derived from the spec it parses with.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const FLEET_LANDED_FLAG_NAMES: readonly string[] = [...LANDED_FLAG_SPEC.string, ...LANDED_FLAG_SPEC.boolean].map(
  (name) => `--${name}`,
);

/** What one `fleet landed` invocation asked for. */
export interface FleetLandedArgs {
  readonly dir: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
  readonly limit: number;
  readonly ref: string | undefined;
}

/** A string flag's value, or `undefined` when it was not supplied. */
function stringFlag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

/**
 * Parse `fleet landed`'s argument tail, strictly, before anything is read.
 *
 * @param rest the argv tail, after `fleet landed`
 * @returns the arguments, or every rejection at once
 */
export function parseFleetLandedArgs({ rest }: { readonly rest: readonly string[] }): Result<FleetLandedArgs> {
  const parsed = parseFlags({ args: rest, spec: LANDED_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const limitText = stringFlag({ name: "limit", values });
  let limit = DEFAULT_LANDED_LIMIT;
  if (limitText !== undefined) {
    limit = Number(limitText);
  }
  const ref = stringFlag({ name: "ref", values });
  const problems: string[] = [];
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LANDED_LIMIT) {
    problems.push(`--limit must be a whole number from 1 to ${String(MAX_LANDED_LIMIT)}, got ${String(limitText)}`);
  }
  if (ref !== undefined && (ref === "" || ref.startsWith("-"))) {
    problems.push(`--ref must name a ref, got ${JSON.stringify(ref)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    dir: stringFlag({ name: "dir", values }),
    home: stringFlag({ name: "home", values }),
    json: values["json"] === true,
    limit,
    ref,
  });
}

/**
 * The human reading of a report: one line per landing, then its words.
 *
 * @param report what was read
 * @returns the lines
 */
export function renderLandedLines({ report }: { report: LandedReport }): readonly string[] {
  const lines = [
    `${report.repo} ${report.ref} @ ${report.refSha.slice(0, 10)} — the last ${String(report.landings.length)} landings`,
  ];
  if (report.ledgerUnread.length > 0) {
    lines.push(`${String(report.ledgerUnread.length)} PR-ledger file(s) would not read:`);
    for (const one of report.ledgerUnread) {
      lines.push(`    ${one.file}: ${one.why}`);
    }
  }
  for (const entry of report.landings) {
    let lead = entry.sha.slice(0, 10);
    if (entry.number !== undefined) {
      lead = `#${String(entry.number)}`;
    }
    lines.push(`${entry.mergedIso}  ${lead}  ${entry.title}`);
    lines.push(`    ${landedWordsLine({ words: entry.words })}`);
  }
  return lines;
}

/**
 * The `--json` document. An absent field is written as `null` rather than dropped, so the console's reader can tell
 * "the report says there is none" from "the report no longer carries that field" and refuse the second.
 *
 * @param report what was read
 * @returns one line of JSON
 */
export function landedJson({ report }: { report: LandedReport }): string {
  return JSON.stringify(report, (_key, value: unknown) => {
    if (value === undefined) {
      return null;
    }
    return value;
  });
}

/** What `fleet landed` touches outside itself. */
export interface FleetLandedDeps {
  readonly now: () => string;
  readonly defaultHome: () => string;
  readonly defaultDir: () => string;
  readonly readReport: (request: {
    dir: string;
    home: string;
    refs: readonly string[];
    limit: number;
    nowIso: string;
  }) => Promise<Result<LandedReport, LandedError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `fleet landed` against injected seams.
 *
 * @param rest the argv tail after `fleet landed`
 * @param deps the clock, the default home and checkout, the reader and the two output channels
 * @returns the process exit code
 */
export async function runFleetLanded({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: FleetLandedDeps;
}): Promise<number> {
  const args = parseFleetLandedArgs({ rest });
  if (args.isErr()) {
    deps.writeDiagnostic(`fleet landed: ${args.error.join("; ")}`);
    return EXIT_USAGE;
  }
  const { dir = deps.defaultDir(), home = deps.defaultHome(), limit, ref } = args.value;
  let refs = DEFAULT_LANDED_REFS;
  if (ref !== undefined) {
    refs = [ref];
  }
  const report = await deps.readReport({ dir, home, limit, nowIso: deps.now(), refs });
  if (report.isErr()) {
    deps.writeDiagnostic(`fleet landed: ${report.error.message}`);
    return EXIT_ERROR;
  }
  if (args.value.json) {
    deps.writeOut(landedJson({ report: report.value }));
    return EXIT_OK;
  }
  renderLandedLines({ report: report.value }).forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/** `slopweaver fleet landed`. */
export const fleetLandedCommand = defineCommand({
  run: (argv) =>
    runFleetLanded({
      deps: {
        defaultDir: () => runningCheckoutRoot(),
        defaultHome: slopweaverHome,
        now: () => new Date().toISOString(),
        readReport: (request) => readLandedReport({ ...request, autonomy: autonomyLedgerPort() }),
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
