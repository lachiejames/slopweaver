/**
 * `slopweaver store import-fleet`'s arguments. Pure: no filesystem, no environment, no clock.
 *
 * Split from `./importFleetCore.ts`, which keeps the report types and lines, when the two captured-turn legs added
 * two source flags and the parser outgrew the module cap.
 */
import { err, ok, type Result } from "#lib/result.js";

import { ADOPT_FLAG, CODEX_HOME_FLAG, DICTATIONS_FLAG, FLEET_LEGS, type FleetLeg } from "./importFleetUsage.js";

/** What the verb was asked to do. */
export interface ImportFleetArgs {
  /** The state home to read the files from. */
  readonly home: string | undefined;
  /** Which legs to run. Every leg when `--only` was not given. */
  readonly legs: readonly FleetLeg[];
  /** Project and count, write nothing at all — not a row, not a connection. */
  readonly dryRun: boolean;
  readonly json: boolean;
  /**
   * Insert the door file lines a marked import has no row for, when they are the ONLY divergence — the operator's
   * assertion that a pre-switch seat appended them during the cutover. Only with `--only door`, never a dry run.
   */
  readonly adoptUnmatchedDoorLines: boolean;
  /** The dictations folder, when `--dictations` named one. */
  readonly dictations: string | undefined;
  /** The Codex home, when `--codex-home` named one. */
  readonly codexHome: string | undefined;
}

/** The accumulator one pass over the tokens fills. Mutable by construction — see {@link applyToken}. */
interface TokenAccumulator {
  readonly problems: string[];
  readonly legs: FleetLeg[];
  home: string | undefined;
  dryRun: boolean;
  json: boolean;
  adoptUnmatchedDoorLines: boolean;
  dictations: string | undefined;
  codexHome: string | undefined;
}

/** The flags that take a directory, and the accumulator field each fills. */
const DIRECTORY_FLAGS = {
  [CODEX_HOME_FLAG]: "codexHome",
  [DICTATIONS_FLAG]: "dictations",
  "--home": "home",
} as const satisfies Record<string, "codexHome" | "dictations" | "home">;

/** The switches that take no value, and the accumulator field each sets. */
const SWITCHES = {
  [ADOPT_FLAG]: "adoptUnmatchedDoorLines",
  "--dry-run": "dryRun",
  "--json": "json",
} as const satisfies Record<string, "adoptUnmatchedDoorLines" | "dryRun" | "json">;

/** Whether a token is one of the directory flags. */
function isDirectoryFlag(token: string): token is keyof typeof DIRECTORY_FLAGS {
  return Object.hasOwn(DIRECTORY_FLAGS, token);
}

/** Whether a token is one of the switches. */
function isSwitch(token: string): token is keyof typeof SWITCHES {
  return Object.hasOwn(SWITCHES, token);
}

/**
 * Parse the verb's arguments.
 *
 * Returns the default `Result<T>` — `E = readonly string[]` — rather than a domain union, per
 * `.claude/rules/error-handling.md`: these are display-only messages no caller branches on.
 *
 * @param argv the argument list after the verb itself
 * @returns the parsed arguments, or the refusal lines to print
 */
export function parseImportFleetArgs({ argv }: { argv: readonly string[] }): Result<ImportFleetArgs> {
  const acc: TokenAccumulator = {
    adoptUnmatchedDoorLines: false,
    codexHome: undefined,
    dictations: undefined,
    dryRun: false,
    home: undefined,
    json: false,
    legs: [],
    problems: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    index += applyToken({ acc, token: argv[index]!, value: argv[index + 1] });
  }
  if (acc.problems.length > 0) {
    return err(acc.problems);
  }
  // No `--only` means every leg, spelled as the whole list rather than as an absent value, so every reader
  // downstream handles one shape.
  const legs = acc.legs.length === 0 ? [...FLEET_LEGS] : acc.legs;
  const combination = combinationProblems({ acc, legs });
  if (combination.length > 0) {
    return err(combination);
  }
  return ok({
    adoptUnmatchedDoorLines: acc.adoptUnmatchedDoorLines,
    codexHome: acc.codexHome,
    dictations: acc.dictations,
    dryRun: acc.dryRun,
    home: acc.home,
    json: acc.json,
    legs,
  });
}

/**
 * Apply one token to the accumulator.
 *
 * @param acc the accumulator, mutated in place
 * @param token the flag itself
 * @param value the token AFTER it, which only a value flag reads
 * @returns how many extra tokens were consumed — 1 for a value flag, 0 for everything else
 */
function applyToken({
  acc,
  token,
  value,
}: {
  acc: TokenAccumulator;
  token: string;
  value: string | undefined;
}): number {
  if (isSwitch(token)) {
    acc[SWITCHES[token]] = true;
    return 0;
  }
  if (isDirectoryFlag(token)) {
    // The flag is consumed either way: a flag with nothing after it has still eaten its slot, and re-reading the
    // missing value as a token would report it twice. An EMPTY value is refused too: `join("", file)` would read the
    // file relative to the working directory, a source no flag named.
    if (value === undefined || value === "") {
      acc.problems.push(`${token} needs a directory`);
      return 1;
    }
    acc[DIRECTORY_FLAGS[token]] = value;
    return 1;
  }
  if (token === "--only") {
    acc.problems.push(...legProblem({ value }));
    const leg = FLEET_LEGS.find((candidate) => candidate === value);
    if (leg !== undefined) {
      acc.legs.push(leg);
    }
    return 1;
  }
  acc.problems.push(`unexpected argument: ${token}`);
  return 0;
}

/**
 * What is wrong with how the flags were combined, if anything: the adoption flag repairs the door leg alone and
 * cannot run dry, and a source flag whose leg is not running would be silently ignored.
 *
 * @param acc everything the tokens set
 * @param legs the legs after the `--only` default
 * @returns the problems to report, or an empty list
 */
function combinationProblems({ acc, legs }: { acc: TokenAccumulator; legs: readonly FleetLeg[] }): readonly string[] {
  const problems: string[] = [];
  if (acc.adoptUnmatchedDoorLines && (legs.length !== 1 || legs[0] !== "door")) {
    problems.push(`${ADOPT_FLAG} needs --only door, and no other leg`);
  }
  if (acc.adoptUnmatchedDoorLines && acc.dryRun) {
    problems.push(`${ADOPT_FLAG} cannot run with --dry-run, which opens no connection to find the unmatched lines`);
  }
  if (acc.dictations !== undefined && !legs.includes("dictations")) {
    problems.push(`${DICTATIONS_FLAG} names the dictations leg's source, and that leg is not running`);
  }
  if (acc.codexHome !== undefined && !legs.includes("codex-messages")) {
    problems.push(`${CODEX_HOME_FLAG} names the codex-messages leg's source, and that leg is not running`);
  }
  return problems;
}

/**
 * What is wrong with `--only`'s value, if anything.
 *
 * @param value the token after the flag, or `undefined` when the flag was last
 * @returns the problem to report, or an empty list when the value names a leg
 */
function legProblem({ value }: { value: string | undefined }): readonly string[] {
  if (value === undefined) {
    return [`--only needs one of ${FLEET_LEGS.join(", ")}`];
  }
  if (FLEET_LEGS.some((candidate) => candidate === value)) {
    return [];
  }
  return [`--only ${value} is not a leg — use one of ${FLEET_LEGS.join(", ")}`];
}
