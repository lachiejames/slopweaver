/**
 * `slopweaver codex gauge` and `codex signin` — the two Codex budget verbs that read ONE home.
 *
 * ## What is here, and what moved out
 *
 * `src/cli/manifests/claude.ts` exposes gauge, route, rotate, signin and watch. `gauge` and `signin` each
 * answer about a single `$CODEX_HOME` and stay here for exactly that reason. `route` reads the whole plan
 * register and every destination's evidence to answer a comparison, so it lives in `./routeRun.ts`; keeping
 * these two single-home is what stops either quietly becoming a fleet report that only ever saw one account.
 *
 * `rotate` is still deliberately absent. It names a plan to swap an ACTIVE session onto, and a Codex home
 * belongs to the session that booted against it — there is no shared active slot to move, so `codex route`
 * naming where NEW work goes is the whole of the question. This paragraph is the record of that being a
 * decision rather than an omission.
 *
 * `codex watch` is the fourth twin and lands with the burn detector it exists to tick, not here.
 *
 * Every verb in this file is READ-ONLY. None writes a credential, spends a Codex turn, or reaches the
 * network: a Codex budget can only be read from the log Codex already wrote (`src/codex/gauge.ts` § Why
 * this is not a probe), which is the sharpest difference from the Claude gauge and the reason these are
 * `external-read`'s cheaper neighbour rather than a probe. `gauge` also reads the plan register, for the
 * install's Codex thresholds alone: its alert and pause bars are the owner's settings, never constants here.
 */
import { readCodexAuth, renderCodexAuth } from "../../../codex/auth.js";
import type { CodexGauge } from "../../../codex/gauge.js";
import { renderCodexGauge } from "../../../codex/gaugeRender.js";
import { type CodexGaugeScan, scanCodexGauge } from "../../../codex/gaugeScan.js";
import { resolveCodexHome } from "../../../codex/quotaLog.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

/** How many argv entries precede a verb's own flags (`node`, `slopweaver`, `codex`, `<verb>`). */
const VERB_ARG_OFFSET = 4;

export const GAUGE_USAGE = "usage: slopweaver codex gauge [--json]";
export const SIGNIN_USAGE = "usage: slopweaver codex signin [--status] [--json]";

/** Whether the caller asked for help, so a verb prints usage and touches nothing. */
function wantsHelp({ rest }: { rest: readonly string[] }): boolean {
  return rest.includes("--help") || rest.includes("-h");
}

/** Whether the caller asked for JSON. */
function wantsJson({ rest }: { rest: readonly string[] }): boolean {
  return rest.includes("--json");
}

/**
 * Every flag this file's verbs accept, beyond `--help`.
 *
 * An unknown flag is a caller mistake refused BEFORE any read, which is what `parseRejectIsIoFree` claims in
 * the manifest — so it is checked here rather than ignored.
 */
const KNOWN_FLAGS: ReadonlySet<string> = new Set(["--json", "--status"]);

/** The first unknown flag in `rest`, or undefined when every one is known. */
function unknownFlag({ rest }: { rest: readonly string[] }): string | undefined {
  return rest.find((entry) => entry.startsWith("-") && !KNOWN_FLAGS.has(entry));
}

/** Print a usage refusal for an unknown flag. Returns the exit code, so a caller can `return` it. */
function refuseUnknownFlag({ flag, usage }: { flag: string; usage: string }): number {
  logger.error({ msg: `unexpected flag ${flag}` });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/** The JSON `gauge` field: the reading, or null when no opened rollout file held one — an ordinary state. */
function gaugeJsonValue({ scan }: { scan: CodexGaugeScan }): CodexGauge | null {
  const gauge = scan.gauge;
  if (gauge === undefined) {
    return null;
  }
  return gauge;
}

/**
 * `codex gauge` — Codex's latest budget reading, with its own age beside it.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCodexGauge(argv: readonly string[]): Promise<number> {
  return runCodexGaugeWith({ argv, deps: { home: slopweaverHome(), port: planRegisterPort() } });
}

/**
 * `codex gauge` over an injected register, so a test reads its thresholds from a seam rather than the store.
 *
 * The register is read only once the parse phase has passed, so `--help` and an unknown flag still answer without
 * any I/O; its `alertAtPercent` and `pauseAtPercent` (`../../../plans/thresholds.ts`) are the bars the react-now
 * lines are judged by, the same ones `codex route` ranks with.
 *
 * @param argv the full process argv
 * @param deps the state home and the plan register port its thresholds are read from
 * @returns the process exit code
 */
export async function runCodexGaugeWith({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: { home: string; port: PlanRegisterPort };
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (wantsHelp({ rest })) {
    logger.out({ line: GAUGE_USAGE });
    return EXIT_OK;
  }
  const bad = unknownFlag({ rest });
  if (bad !== undefined) {
    return refuseUnknownFlag({ flag: bad, usage: GAUGE_USAGE });
  }
  const codexHome = resolveCodexHome();
  const register = await deps.port.read({ home: deps.home });
  if (register.isErr()) {
    logger.error({ msg: `codex gauge: the plan register could not be read — ${register.error.message}` });
    return EXIT_ERROR;
  }
  const thresholds = register.value.thresholds.codex;
  // The scan drops a reading dated after it began, and the render judges a reset at the LATER instant it prints
  // at: every kept reading is then no later than the render's now, and a reset passing mid-scan is seen.
  const scan = scanCodexGauge({ codexHome, nowMs: Date.now() });
  const nowIso = new Date().toISOString();
  if (wantsJson({ rest })) {
    logger.out({ line: JSON.stringify({ ...scan, gauge: gaugeJsonValue({ scan }), readAtIso: nowIso, thresholds }) });
    return EXIT_OK;
  }
  for (const line of renderCodexGauge({ gauge: scan.gauge, nowIso, thresholds })) {
    logger.out({ line });
  }
  logger.out({
    line: `  scanned ${String(scan.filesRead)} rollout file(s), ${String(scan.filesSkipped)} beyond the bound`,
  });
  return EXIT_OK;
}

/**
 * `codex signin` — what `$CODEX_HOME/auth.json` says, with no token value ever read.
 *
 * `--status` is accepted and is the only behaviour: there is no interactive half, because Slopweaver never
 * performs a Codex sign-in. The flag exists so the Claude verb's own spelling works here too.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runCodexSignin(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (wantsHelp({ rest })) {
    logger.out({ line: SIGNIN_USAGE });
    return EXIT_OK;
  }
  const bad = unknownFlag({ rest });
  if (bad !== undefined) {
    return refuseUnknownFlag({ flag: bad, usage: SIGNIN_USAGE });
  }
  const report = readCodexAuth({ codexHome: resolveCodexHome() });
  if (wantsJson({ rest })) {
    logger.out({ line: JSON.stringify(report) });
    return EXIT_OK;
  }
  for (const line of renderCodexAuth({ report })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/** The `codex gauge` verb. */
export const codexGaugeCommand = defineCommand({ run: runCodexGauge });

/** The `codex signin` verb. */
export const codexSigninCommand = defineCommand({ run: (argv) => runCodexSignin(argv) });
