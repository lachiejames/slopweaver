/**
 * `slopweaver datadog submit --series FILE|- [--allow-late] [--dry-run] [--json]` — the Datadog door's
 * write half: submit gauge metric points to `/api/v1/series`.
 *
 * The verb knows nothing about any particular metric family. It takes a payload someone else computed,
 * checks it is a submittable gauge submission, says exactly which UTC days it would stamp, routes the
 * effect through the admit door so the write is journalled, and sends it. That split is deliberate: the
 * SEMANTICS of a metric belong to whatever produced it, and a door that also knew how to compute one
 * would be a second, drifting definition of the same numbers.
 *
 * ## The exit-code contract
 *
 * | situation                                                              | code |
 * | ---------------------------------------------------------------------- | ---- |
 * | a bad flag, a missing `--series`, a malformed or non-gauge payload     | `2`  |
 * | credentials unset or malformed                                         | `3`  |
 * | backdated points with no `--allow-late`, or the door refused the write | `3`  |
 * | the `--series` file could not be read                                  | `1`  |
 * | Datadog rejected a batch, or one never reached it                      | `1`  |
 * | the payload landed (or `--dry-run` planned it)                         | `0`  |
 *
 * A `1` from the send always names how many batches had ALREADY been accepted, because a partial submission has
 * changed Datadog and a caller who re-runs blind would double-submit the batches that landed.
 */
import { readFileSync } from "node:fs";

import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorRequest } from "../../../admit/types.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { parseSeriesPayload } from "../../../datadog/seriesPayload.js";
import { planSubmission, type SubmissionPlan, submitGaugeSeries } from "../../../datadog/seriesSubmit.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { parseDatadogSubmitOptions, submitPlanLines } from "./core.js";
import { datadogArgsErrorLines } from "./errors.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's Datadog-client dependency for every CLI invocation.
 */
export const DATADOG_SUBMIT_USAGE =
  "usage: slopweaver datadog submit --series FILE|- [--allow-late] [--dry-run] [--home DIR] [--json]";

/**
 * The door request one submission makes.
 *
 * `effect: "external-write"` and nothing softer: this changes what Datadog says about the estate, and
 * Datadog cannot delete a metric point, so it is the least reversible write any verb in this package can
 * perform. The artifact carries the DAYS rather than only a count so a gate can read them; the ledger line
 * records the decision and not artifact contents by design (`admit/ledger.ts`), which is why the verb also
 * prints the days itself — "which days did that run fill" has to be answerable from the run's own output.
 *
 * @param home the state home whose ledger records this write
 * @param plan the planned submission
 * @returns the request to route through the door
 */
export function submitDoorRequestFor({ home, plan }: { home: string; plan: SubmissionPlan }): DoorRequest {
  return {
    action: { kind: "verb", noun: "datadog", verb: "submit" },
    artifact: {
      latePointCount: plan.latePointCount,
      pointCount: plan.pointCount,
      seriesCount: plan.seriesCount,
      utcDays: [...plan.utcDays],
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/** Read the payload text from a file path, or from stdin when the path is `-`. */
async function readPayload({ series }: { series: string }): Promise<string> {
  return series === "-" ? readStdin() : readFileSync(series, "utf8");
}

/**
 * Run the `datadog submit` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogSubmit(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["submit"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_SUBMIT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseDatadogSubmitOptions({ rest });
  if (parsed.isErr()) {
    for (const line of datadogArgsErrorLines({ error: parsed.error })) {
      logger.error({ msg: line });
    }
    logger.error({ msg: DATADOG_SUBMIT_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;

  let text: string;
  try {
    text = await readPayload({ series: options.series });
  } catch (error: unknown) {
    logger.error({ msg: `cannot read ${options.series}: ${errorMessage({ error })}` });
    return EXIT_ERROR;
  }

  const payload = parseSeriesPayload({ text, label: options.series });
  if (payload.isErr()) {
    logger.error({ msg: payload.error.message });
    return EXIT_USAGE;
  }

  const plan = planSubmission({
    allowLate: options.allowLate,
    nowSeconds: Math.floor(Date.now() / 1000),
    series: payload.value,
  });
  if (plan.isErr()) {
    logger.error({ msg: plan.error.message });
    return plan.error.code === "LATE_POINTS_REFUSED" ? EXIT_EXPECTED_EMPTY : EXIT_USAGE;
  }

  if (options.dryRun) {
    report({
      json: options.json,
      lines: submitPlanLines({ plan: plan.value, verb: "would submit" }),
      plan: plan.value,
    });
    return EXIT_OK;
  }
  return send({ home: options.home, json: options.json, plan: plan.value });
}

/** The act phase: resolve credentials, route the write through the door, and report what landed. */
async function send({
  home: requestedHome,
  json,
  plan,
}: {
  home: string | undefined;
  json: boolean;
  plan: SubmissionPlan;
}): Promise<number> {
  const home = resolveHome({ named: requestedHome });
  const config = loadDatadogConfig({ home });
  if (config.isErr()) {
    datadogConfigErrorLines({ error: config.error }).forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_EXPECTED_EMPTY;
  }

  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: doorLedgerPort(),
    perform: () => submitGaugeSeries({ config: config.value, logger, plan }),
    request: submitDoorRequestFor({ home, plan }),
  });
  if (!routed.performed) {
    notPerformedLines({ command: "slopweaver datadog submit", through: routed }).forEach((line) => {
      logger.error({ msg: line });
    });
    // A recording refusal is the store's failure, not a policy refusal: it exits as an error, not as expected-empty.
    return routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
  }
  if (routed.result.isErr()) {
    logger.error({ msg: routed.result.error.message });
    return EXIT_ERROR;
  }
  report({ json, lines: submitPlanLines({ plan, verb: "submitted" }), plan });
  return EXIT_OK;
}

/** Print the outcome on the data channel, as JSON or as lines. */
function report({ json, lines, plan }: { json: boolean; lines: readonly string[]; plan: SubmissionPlan }): void {
  if (json) {
    logger.out({
      line: JSON.stringify(
        {
          batches: plan.batches.length,
          earliestIso: plan.earliestIso,
          latePointCount: plan.latePointCount,
          latestIso: plan.latestIso,
          pointCount: plan.pointCount,
          seriesCount: plan.seriesCount,
          utcDays: plan.utcDays,
        },
        null,
        2,
      ),
    });
    return;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
}

export const datadogSubmitCommand = defineCommand({ run: runDatadogSubmit });
