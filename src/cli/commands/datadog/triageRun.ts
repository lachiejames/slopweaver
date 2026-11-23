/**
 * `slopweaver datadog triage --issue ID[,ID…] --state reviewed|ignored|resolved|for-review [--dry-run]` —
 * move Error Tracking issues out of For Review, the WRITE half of the error-tracking fix batch
 * (`skills/automation/reference/error-tracking-batch.md` step 6). `datadog/errorTrackingTriage.ts` carries
 * the route and why; this is the shell.
 *
 * Read every issue, plan, move what is not already there through the admit door, then READ EVERY ONE BACK.
 * An accepted PUT is never enough for success — exit 0 is the read-back's — while a failed PUT, Datadog's own
 * refusal or a lost answer, stops the run there, with no read-back. A move is not inert: Error Tracking monitors read issue
 * state, so Ignored mutes an issue's notifications and For Review makes it eligible again. There is still no
 * approval digest, unlike `monitor update`, because moving triaged issues itself is the batch's job (the
 * board row's stated purpose), the same verb undoes any move, and `autonomy record` traces each one.
 *
 * ## The receipt
 *
 * The door ledger records that a triage was admitted, never which issues changed. So every outcome past the
 * credentials names the evidence for each move: `--json` prints ONE {@link TriageReport} whatever the outcome
 * — a door refusal included — carrying `moved` (accepted, and read back in the target state) and `uncertain`
 * (a move whose outcome this run cannot attribute). A failure's message names them in text. A non-zero exit
 * after a move may still have changed Datadog.
 *
 * ## The exit-code contract
 *
 * | situation                                                              | code |
 * | ---------------------------------------------------------------------- | ---- |
 * | a bad flag, no `--issue`/`--state`, or an id that is not an issue id   | `2`  |
 * | credentials unset or malformed, or the door refused the write          | `3`  |
 * | an issue Datadog does not know, a failed read, a state that moved      | `1`  |
 * | under the plan, a refused or unconfirmed move, or a read-back finding  |      |
 * | one elsewhere                                                          |      |
 * | planned (`--dry-run`), or moved (or already there) and read back there | `0`  |
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import type { DoorStoreError } from "../../../admit/doorStoreErrors.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorFinding, DoorGate, DoorRequest } from "../../../admit/types.js";
import { createDatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import {
  issuesNotAt,
  moveIssues,
  planTriage,
  readIssueStates,
  type TriageApi,
  type TriagePlan,
  validateIssueIds,
} from "../../../datadog/errorTrackingTriage.js";
import {
  type DatadogTriageError,
  DatadogTriageErrors,
  type IssueStateRow,
  movedBeforeOf,
  uncertainOf,
} from "../../../datadog/errorTrackingTriageErrors.js";
import { sdkTriageApi } from "../../../datadog/errorTrackingTriageSdk.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { datadogArgsErrorLines } from "./errors.js";
import {
  type DatadogTriageOptions,
  parseDatadogTriageOptions,
  triagePlanLines,
  triageStateLines,
} from "./triageCore.js";
import { DATADOG_TRIAGE_USAGE } from "./usage.js";

/**
 * The door request one triage makes: `external-write`, because it changes what the team's Error Tracking
 * list says about these issues.
 *
 * @param home the state home whose ledger records this write
 * @param plan the moves this run will make
 * @returns the request to route through the door
 */
export function triageDoorRequestFor({ home, plan }: { home: string; plan: TriagePlan }): DoorRequest {
  return {
    action: { kind: "verb", noun: "datadog", verb: "triage" },
    artifact: { issues: plan.toMove.map((row) => row.id), state: plan.target },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/** The one `--json` document a run prints, whatever its outcome. */
export interface TriageReport {
  readonly dryRun: boolean;
  /** The plan, once every issue was read; `null` when the first read failed. */
  readonly plan: TriagePlan | null;
  /**
   * The ids whose PUT Datadog accepted and a read straight after found in the target state — the receipt,
   * present on failure too. A postcondition, not proof of cause (`moveIssues` says why).
   */
  readonly moved: readonly string[];
  /**
   * The ids whose move MAY have happened: the PUT's answer was lost, or it was accepted and no read showed it
   * land — record each as possibly moved, never as untouched.
   */
  readonly uncertain: readonly string[];
  /** Each issue as the read-back found it; `null` on a dry run or a failure before the read-back finished. */
  readonly issues: readonly IssueStateRow[] | null;
  readonly error: {
    /** `DOOR_REFUSED` is policy; the door store's own code means the decision could not be recorded, so nothing moved. */
    readonly code: DatadogTriageError["code"] | "DOOR_REFUSED" | DoorStoreError["code"];
    readonly message: string;
    /** The door's findings on a refusal; empty for every other failure. */
    readonly findings: readonly DoorFinding[];
  } | null;
}

/** Where a run stopped early: the report to print and the code to exit with. */
interface TriageStop {
  readonly report: TriageReport;
  readonly exit: number;
}

/** A failure's report: the receipt it carries, no read-back. */
function failureReport({
  error,
  plan,
  dryRun,
}: {
  error: DatadogTriageError;
  plan: TriagePlan | null;
  dryRun: boolean;
}): TriageReport {
  return {
    dryRun,
    error: { code: error.code, findings: [], message: error.message },
    issues: null,
    moved: movedBeforeOf({ error }),
    plan,
    uncertain: uncertainOf({ error }),
  };
}

/**
 * Run one triage against a bound seam — everything after credentials, so a test drives it with a fake and its
 * own gates.
 *
 * @param api the Error Tracking seam
 * @param ids the validated issue ids
 * @param options the parsed invocation
 * @param home the state home whose door ledger records the write
 * @param gates the door's gate list (`DEFAULT_GATES` in the verb)
 * @param ledger the door ledger the write's decision is recorded through
 * @param print where each data-channel line goes
 * @returns the exit code
 */
export async function runTriage({
  api,
  ids,
  options,
  home,
  gates,
  ledger,
  print,
}: {
  api: TriageApi;
  ids: readonly string[];
  options: DatadogTriageOptions;
  home: string;
  gates: readonly DoorGate[];
  ledger: DoorLedgerPort;
  print: (args: { line: string }) => void;
}): Promise<number> {
  const show = ({ report, lines }: { report: TriageReport; lines: readonly string[] }): void => {
    emit({ json: options.json, lines, print, report });
  };
  const before = await readIssueStates({ api, ids, movedBefore: [] });
  if (before.isErr()) {
    show({ lines: [], report: failureReport({ dryRun: options.dryRun, error: before.error, plan: null }) });
    return EXIT_ERROR;
  }
  const plan = planTriage({ rows: before.value, target: options.state });
  if (options.dryRun) {
    const report = { dryRun: true, error: null, issues: null, moved: [], plan, uncertain: [] };
    show({ lines: triagePlanLines({ plan, verb: "would move" }), report });
    return EXIT_OK;
  }
  // Printed before the door decides, so it states the plan, never an act: a refusal follows it sending nothing.
  if (!options.json && plan.toMove.length > 0) {
    triagePlanLines({ plan, verb: "plan: move" }).forEach((line) => {
      print({ line });
    });
  }
  const moved = await moveThroughDoor({ api, gates, home, ledger, plan });
  if (moved.isErr()) {
    show({ lines: [], report: moved.error.report });
    return moved.error.exit;
  }
  const after = await readIssueStates({ api, ids, movedBefore: moved.value });
  if (after.isErr()) {
    show({ lines: [], report: failureReport({ dryRun: false, error: after.error, plan }) });
    return EXIT_ERROR;
  }
  const verdict = readBackVerdict({ moved: moved.value, plan, rows: after.value, target: options.state });
  show({ lines: verdict.lines, report: verdict.report });
  return verdict.exit;
}

/** What the read-back after a move says: the state lines, the report, and whether every issue landed on the target. */
function readBackVerdict({
  moved,
  plan,
  rows,
  target,
}: {
  moved: readonly string[];
  plan: TriagePlan;
  rows: readonly IssueStateRow[];
  target: DatadogTriageOptions["state"];
}): { readonly exit: number; readonly lines: readonly string[]; readonly report: TriageReport } {
  const lines = triageStateLines({ rows });
  const elsewhere = issuesNotAt({ rows, target });
  if (elsewhere.length > 0) {
    const error = DatadogTriageErrors.notMoved({ movedBefore: moved, stillElsewhere: elsewhere, target: plan.target });
    return { exit: EXIT_ERROR, lines, report: { ...failureReport({ dryRun: false, error, plan }), issues: rows } };
  }
  return {
    exit: EXIT_OK,
    lines,
    report: { dryRun: false, error: null, issues: rows, moved, plan, uncertain: [] },
  };
}

/** Move the plan inside one door request; nothing to move admits nothing. */
async function moveThroughDoor({
  api,
  gates,
  home,
  ledger,
  plan,
}: {
  api: TriageApi;
  gates: readonly DoorGate[];
  home: string;
  ledger: DoorLedgerPort;
  plan: TriagePlan;
}): Promise<Result<readonly string[], TriageStop>> {
  if (plan.toMove.length === 0) {
    return ok([]);
  }
  const routed = await throughDoor({
    gates,
    home,
    ledger,
    perform: () => moveIssues({ api, plan }),
    request: triageDoorRequestFor({ home, plan }),
  });
  if (routed.kind === "recording-refused") {
    // The store could not record the decision, so nothing moved: infrastructure, not a policy refusal.
    const message = notPerformedLines({ command: "slopweaver datadog triage", through: routed }).join("\n");
    const error = { code: routed.error.code, findings: [], message };
    const report = { dryRun: false, error, issues: null, moved: [], plan, uncertain: [] };
    return err({ exit: EXIT_ERROR, report });
  }
  if (!routed.performed) {
    const message = notPerformedLines({ command: "slopweaver datadog triage", through: routed }).join("\n");
    const error = { code: "DOOR_REFUSED" as const, findings: routed.decision.findings, message };
    const report = { dryRun: false, error, issues: null, moved: [], plan, uncertain: [] };
    return err({ exit: EXIT_EXPECTED_EMPTY, report });
  }
  if (routed.result.isErr()) {
    return err({ exit: EXIT_ERROR, report: failureReport({ dryRun: false, error: routed.result.error, plan }) });
  }
  return ok(routed.result.value);
}

/** Print a run's outcome: the one JSON document, or the text lines and any failure on stderr. */
function emit({
  json,
  lines,
  print,
  report,
}: {
  json: boolean;
  lines: readonly string[];
  print: (args: { line: string }) => void;
  report: TriageReport;
}): void {
  if (json) {
    print({ line: JSON.stringify(report, null, 2) });
    return;
  }
  lines.forEach((line) => {
    print({ line });
  });
  if (report.error !== null) {
    logger.error({ msg: report.error.message });
  }
}

/**
 * Run the `datadog triage` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogTriage(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["triage"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_TRIAGE_USAGE });
    return EXIT_OK;
  }
  const invocation = readInvocation({ rest });
  if (invocation === null) {
    return EXIT_USAGE;
  }
  const { options, ids } = invocation;

  const home = resolveHome({ named: options.home });
  const config = loadDatadogConfig({ home });
  if (config.isErr()) {
    datadogConfigErrorLines({ error: config.error }).forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const api = sdkTriageApi({ errorTracking: createDatadogClient({ config: config.value, logger }).errorTracking });
  return runTriage({ api, gates: DEFAULT_GATES, home, ids, ledger: doorLedgerPort(), options, print: logger.out });
}

/** Parse the flags and validate the ids, printing every refusal; `null` means the caller exits 2. */
function readInvocation({
  rest,
}: {
  rest: readonly string[];
}): { options: DatadogTriageOptions; ids: readonly string[] } | null {
  const parsed = parseDatadogTriageOptions({ rest });
  if (parsed.isErr()) {
    for (const line of datadogArgsErrorLines({ error: parsed.error })) {
      logger.error({ msg: line });
    }
    logger.error({ msg: DATADOG_TRIAGE_USAGE });
    return null;
  }
  const ids = validateIssueIds({ ids: parsed.value.issues });
  if (ids.isErr()) {
    logger.error({ msg: ids.error.message });
    return null;
  }
  return { ids: ids.value, options: parsed.value };
}

export const datadogTriageCommand = defineCommand({ run: runDatadogTriage });
