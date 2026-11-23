/**
 * `slopweaver store push | verify | baseline | reset` — the lifecycle verbs, the archive's `db-push` and
 * `db-reset` as one noun's verbs here. Thin effectful shells: parsing and rendering are pure
 * ({@link ./lifecycleArgs}), the acts are `src/store/lifecycle.ts`.
 *
 * These four open the store RAW (`openStore`, never `connectStore`), because they are what moves a
 * database between the states every other verb refuses on. The local-only rule still applies — the URL
 * is resolved through `storeUrl`, which refuses a remote host with no hatch — and `resetStore` refuses one
 * itself for a caller handing it a raw URL.
 */
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { storeUrl, storeUrlSelection } from "../../../store/config.js";
import { storeErrorLines } from "../../../store/errors.js";
import { baselineStore, pushStore, resetStore, verifyStore } from "../../../store/lifecycle.js";
import type { FoundSelection } from "../../../store/lock/localStack.js";
import { measureLock } from "../../../store/lock/measure.js";
import type { LockMeasurement } from "../../../store/lock/reconcile.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { storeTail } from "./core.js";
import { storeCommandErrorLines } from "./errors.js";
import {
  baselineLines,
  parseBaselineArgs,
  parsePushArgs,
  parseResetArgs,
  parseVerifyArgs,
  pushLines,
  resetLines,
  verifyLines,
} from "./lifecycleArgs.js";
import { lockMeasurementLines } from "./lockCore.js";
import { productionLockDeps, readStack, workdirOf } from "./lockRun.js";
import { resolvedHome } from "./verbShell.js";

const PUSH_USAGE = "usage: slopweaver store push [--no-generate] [--home <dir>] [--json]";
const VERIFY_USAGE = "usage: slopweaver store verify [--workdir <checkout>] [--home <dir>] [--json]";
const BASELINE_USAGE = "usage: slopweaver store baseline --through <tag> [--home <dir>] [--json]";
const RESET_USAGE = "usage: slopweaver store reset --acknowledge <database> [--home <dir>] [--json]";

/**
 * Print every refusal, then the usage, and return the caller-mistake exit code.
 *
 * @param lines every reason the invocation was refused
 * @param usage the verb's own usage line
 * @returns the exit code to return
 */
function refuse({ lines, usage }: { lines: readonly string[]; usage: string }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/**
 * Emit a report, as JSON on stdout or as lines on stdout.
 *
 * @param json whether the caller asked for the machine-readable form
 * @param lines the human report
 * @param payload the machine-readable document
 */
function emit({ json, lines, payload }: { json: boolean; lines: readonly string[]; payload: unknown }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "store lifecycle report", value: payload }) });
    return;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Resolve the store URL for a lifecycle verb, or print why it could not be.
 *
 * @param home the Slopweaver home the remembered selection is read under
 * @returns the URL, or the exit code
 */
function urlOrRefuse({ home }: { home: string | undefined }): { url: string } | { code: number } {
  const url = storeUrl(home === undefined ? {} : { home });
  if (url.isErr()) {
    logger.error({ msg: url.error.message });
    return { code: EXIT_ERROR };
  }
  return { url: url.value };
}

/**
 * Generate a migration if the schema changed, apply everything pending, verify the database matches.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStorePush(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PUSH_USAGE });
    return EXIT_OK;
  }
  const args = parsePushArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: PUSH_USAGE });
  }
  const selected = urlOrRefuse({ home: args.value.home });
  if ("code" in selected) {
    return selected.code;
  }
  const report = await pushStore({
    cwd: installedTreeRoot({ importMetaUrl: import.meta.url }),
    generate: args.value.generate,
    url: selected.url,
  });
  if (report.isErr()) {
    storeErrorLines({ error: report.error }).forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_ERROR;
  }
  emit({ json: args.value.json, lines: pushLines({ report: report.value }), payload: report.value });
  return report.value.verify.findings.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/**
 * Read the database back against the schema and report every disagreement.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero on any finding
 */
export async function runStoreVerify(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VERIFY_USAGE });
    return EXIT_OK;
  }
  const args = parseVerifyArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: VERIFY_USAGE });
  }
  // The selection is read ONCE and both halves judge that one URL: a second read let a store-url swapped between them
  // turn a schema check that logged in as postgres into a clean exit.
  const home = resolvedHome({ home: args.value.home });
  const selection = storeUrlSelection({ home });
  if (selection.isErr()) {
    logger.error({ msg: selection.error.message });
    return EXIT_ERROR;
  }
  const report = await verifyStore({
    cwd: installedTreeRoot({ importMetaUrl: import.meta.url }),
    url: selection.value.url,
  });
  if (report.isErr()) {
    storeErrorLines({ error: report.error }).forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_ERROR;
  }
  const lock = await lockMeasurementFor({
    home,
    selection: { origin: selection.value.origin, url: selection.value.url },
    workdir: args.value.workdir,
  });
  emit({
    json: args.value.json,
    lines: [
      ...verifyLines({
        declaredTables: report.value.declaredTables,
        findings: report.value.findings,
        state: report.value.state,
      }),
      ...lockMeasurementLines({ measurement: lock }),
    ],
    payload: { ...report.value, lock },
  });
  const lockClean = "notMeasured" in lock || lock.findings.length === 0;
  return report.value.findings.length === 0 && lockClean ? EXIT_OK : EXIT_ERROR;
}

/**
 * Measure the store lock read-only. A selection on another host is NOT MEASURED and says so; one that reaches this
 * stack by any route, or logs in on this Mac where that cannot be disproved, is a finding; an unreadable stack config
 * and anything else that stops the measurement is a finding, so a local store whose lock cannot be read never reads
 * clean.
 *
 * @param home the Slopweaver home the hatch grant is read under
 * @param selection the store URL the schema check already judged, never read a second time
 * @param workdir the checkout naming the stack, when `--workdir` named one
 * @returns what held and what did not, or why it was not measured
 */
async function lockMeasurementFor({
  home,
  selection,
  workdir,
}: {
  home: string;
  selection: NonNullable<FoundSelection>;
  workdir: string | undefined;
}): Promise<LockMeasurement | { notMeasured: string }> {
  const stack = readStack({ workdir: workdirOf({ workdir }) });
  if (stack.isErr()) {
    // A finding, never "not measured": the stack's config is what tells a URL on this stack from one elsewhere, so
    // a `--workdir` naming no stack would otherwise let any login read clean.
    return {
      findings: [
        `no lock can be measured without the stack's config, so verify fails rather than reading clean (${stack.error.message})`,
      ],
      held: [],
    };
  }
  const localElsewhereOpen = hatchOpen({
    env: process.env,
    home,
    id: "local-store-elsewhere",
    nowIso: new Date().toISOString(),
  });
  const localElsewhere = localElsewhereOpen
    ? ({ open: true } as const)
    : ({ open: false, refusal: hatchRefusal({ hatch: hatchFor({ id: "local-store-elsewhere" }) }) } as const);
  const measured = await measureLock({
    deps: productionLockDeps(),
    localElsewhere,
    selection,
    stack: stack.value,
  });
  if (measured.isOk()) {
    return measured.value;
  }
  if (measured.error.code === "NOT_LOCAL_STACK") {
    return { notMeasured: measured.error.message };
  }
  return { findings: [`the lock could not be measured: ${measured.error.message}`], held: [] };
}

/**
 * Record migrations as already applied on a database whose tables were created by hand.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreBaseline(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: BASELINE_USAGE });
    return EXIT_OK;
  }
  const args = parseBaselineArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: args.error }), usage: BASELINE_USAGE });
  }
  const selected = urlOrRefuse({ home: args.value.home });
  if ("code" in selected) {
    return selected.code;
  }
  const report = await baselineStore({
    cwd: installedTreeRoot({ importMetaUrl: import.meta.url }),
    through: args.value.through,
    url: selected.url,
  });
  if (report.isErr()) {
    storeErrorLines({ error: report.error }).forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_ERROR;
  }
  emit({ json: args.value.json, lines: baselineLines({ report: report.value }), payload: report.value });
  return EXIT_OK;
}

/**
 * Drop everything in one LOCAL database and rebuild it from the schema.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreReset(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RESET_USAGE });
    return EXIT_OK;
  }
  const args = parseResetArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: RESET_USAGE });
  }
  const selected = urlOrRefuse({ home: args.value.home });
  if ("code" in selected) {
    return selected.code;
  }
  // `storeUrl` refuses a remote host with no hatch, and `resetStore` refuses one itself for a caller that hands
  // it a raw URL, so a drop only ever reaches a database on this machine.
  const report = await resetStore({
    acknowledged: args.value.acknowledge,
    cwd: installedTreeRoot({ importMetaUrl: import.meta.url }),
    url: selected.url,
  });
  if (report.isErr()) {
    storeErrorLines({ error: report.error }).forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_ERROR;
  }
  emit({ json: args.value.json, lines: resetLines({ report: report.value }), payload: report.value });
  return report.value.push.verify.findings.length === 0 ? EXIT_OK : EXIT_ERROR;
}

export const storePushCommand = defineCommand({ run: runStorePush });
export const storeVerifyCommand = defineCommand({ run: runStoreVerify });
export const storeBaselineCommand = defineCommand({ run: runStoreBaseline });
export const storeResetCommand = defineCommand({ run: runStoreReset });
