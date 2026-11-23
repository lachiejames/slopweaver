/**
 * `slopweaver codex route` — which registered Codex destination new work lands on, and what stops it.
 *
 * Its own file rather than a section of `./gaugeRun.ts`, and the seam is what the verb READS: `gauge` and
 * `signin` each look at ONE Codex home, while this one reads the whole register and every destination's
 * evidence to answer a comparison. Keeping the single-home verbs single-home is what stops either of them
 * quietly becoming a fleet report that only ever saw one account.
 *
 * STDOUT CARRIES THE MACHINE RESULT: `--json` writes one document a caller parses, and every refusal and
 * usage line goes to stderr.
 */
import { readChildDeadline } from "#lib/childDeadline.js";

import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import { assessCodexFleet } from "../../../codex/fleetAssessment.js";
import { type CodexFleetCapPort, codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { readCodexFleetSnapshot } from "../../../codex/fleetRead.js";
import { renderCodexFleet } from "../../../codex/fleetRender.js";
import { CODEX_MODEL } from "../../../codex/profiles.js";
import { type CodexSignInPort, codexSignInPort } from "../../../codex/signInPort.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

/** Where a `codex <verb>` flag tail begins in `process.argv` — `[node, cli, codex, route, ...]`, so 4. */
const VERB_ARG_OFFSET = 4;

/** The value-taking flags `codex route` accepts. */
const ROUTE_STRING_FLAGS: readonly string[] = ["home"];

/** The boolean flags it accepts. */
const ROUTE_BOOLEAN_FLAGS: readonly string[] = ["full", "json"];

/** The parser's spec, built from the two lists so neither can disagree with the usage string. */
const ROUTE_FLAGS: FlagSpec = { boolean: [...ROUTE_BOOLEAN_FLAGS], string: [...ROUTE_STRING_FLAGS] };

/** `codex route`'s advertised flags, for the help-truth ratchet. Derived from the same two lists. */
export const CODEX_ROUTE_FLAG_NAMES: readonly string[] = [...ROUTE_BOOLEAN_FLAGS, ...ROUTE_STRING_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** Usage for `codex route`, kept beside the verb so `--help` and the parser share one string. */
export const ROUTE_USAGE =
  "usage: slopweaver codex route [--json] [--full] [--home <dir>]\n" +
  "\n" +
  "  Reads the plan register and every registered Codex destination's own rollout log, then names the\n" +
  "  destination new work would take, why, and what every other destination is doing. A paused or refusing\n" +
  "  row still appears, with its reason: a fleet report that omits the awkward row is one nobody can act on.\n" +
  "  By default each destination is one line — the windows its reading carries, with their resets, its\n" +
  "  disposition and why, its free resets, a live read or scan it could not make — plus an ACCOUNT DRIFT\n" +
  "  line when its account moved. --full adds\n" +
  "  each one's signed-in account, allowance, store and scan; --json is the whole assessment.\n" +
  "  Under a parent's kill deadline (SLOPWEAVER_CHILD_DEADLINE_AT_MS, set by `talk verb`) it reads only each\n" +
  "  store's live answer, cached cap record and clear mark, opens no rollout log, and says so on every row.\n" +
  "\n" +
  "  --home  the state home holding the register and the cached quota records. Defaults to this install's.";

/**
 * The home the register is read from: the one `--home` named, or this install's own.
 *
 * An `if` that RETURNS rather than an operator — the substitution is a real decision, and
 * `.claude/rules/typescript-patterns.md` § No silent fallback is why it is spelled out.
 *
 * @param home the `--home` the caller passed, if any
 * @returns the home to read
 */
function resolvedHomeOf({ home }: { home: unknown }): string {
  if (typeof home !== "string") {
    return slopweaverHome();
  }
  return home;
}

/**
 * Parse `codex route` flags. Exported so the help-truth ratchet can probe the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexRouteArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ allowPositionals: false, args: rest, spec: ROUTE_FLAGS });
}

/**
 * `codex route` — where new Codex work would land, across every registered destination.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCodexRoute(argv: readonly string[]): Promise<number> {
  return runCodexRouteOver({
    argv,
    fleetCap: codexFleetCapPort(),
    port: planRegisterPort(),
    signInPort: codexSignInPort(),
  });
}

/**
 * {@link runCodexRoute} over injected store ports — the seam a test reaches the verb through without a
 * store.
 *
 * @param argv the full process argv
 * @param port where the plan register is read
 * @param fleetCap where the read files the fleet's conclusion
 * @param signInPort where the fleet read files each store's sign-in observation
 * @returns the process exit code
 */
export async function runCodexRouteOver({
  argv,
  fleetCap,
  port,
  signInPort,
}: {
  argv: readonly string[];
  fleetCap: CodexFleetCapPort;
  port: PlanRegisterPort;
  signInPort: CodexSignInPort;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ROUTE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexRouteArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: ROUTE_USAGE });
    return EXIT_USAGE;
  }
  // Under `talk verb` the parent kills this at a fixed instant, and a fleet read grows with the register, so the
  // read is handed that instant to size itself to — never a deadline of its own, which a seat's read has none of.
  const deadlineAtMs = readChildDeadline({ env: process.env });
  if (deadlineAtMs.isErr()) {
    logger.error({ msg: `codex route: ${deadlineAtMs.error.message}` });
    return EXIT_ERROR;
  }
  const snapshot = await readCodexFleetSnapshot({
    ...(deadlineAtMs.value === null ? {} : { deadlineAtMs: deadlineAtMs.value }),
    fleetCap,
    home: resolvedHomeOf({ home: parsed.value.values["home"] }),
    nowIso: new Date().toISOString(),
    port,
    readLive: readCodexAccountsLive,
    signInPort,
  });
  if (snapshot.isErr()) {
    // The register's own typed error, never an empty fleet standing in for one: "no destinations" and
    // "the register would not decode" are opposite answers and a router must not confuse them.
    logger.error({ msg: `codex route: ${snapshot.error.message}` });
    return EXIT_ERROR;
  }
  const assessment = assessCodexFleet({ requestedModel: CODEX_MODEL, snapshot: snapshot.value });
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(assessment) });
    return EXIT_OK;
  }
  for (const line of renderCodexFleet({ assessment, full: parsed.value.values["full"] === true })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/** The `codex route` verb. */
export const codexRouteCommand = defineCommand({ run: runCodexRoute });
