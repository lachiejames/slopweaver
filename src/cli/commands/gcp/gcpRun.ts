/**
 * `slopweaver gcp <run|secret|service-account|services|artifacts> <action>` — the door every GCP read and write
 * a seat makes goes through, in place of raw `gcloud`. This is the shell: it parses, binds the sender, reads
 * a payload file, and dispatches; `../../../gcp/` carries every rule.
 *
 * ## A write is two invocations
 *
 * Without `--approve` the write reads what it depends on, prints every step and a digest, and sends NOTHING —
 * and records nothing, because routing a preview would write a ledger line for a change that never happened.
 * With `--approve` it reads everything AGAIN, plans again, and sends each step through the door, whose gate
 * compares the approval to the digest of THAT plan: a resource that moved since the preview holds.
 *
 * ## The exit-code contract
 *
 * | situation                                                                   | code |
 * | --------------------------------------------------------------------------- | ---- |
 * | a bad flag, name or file shape                                              | `2`  |
 * | nothing to change; the edit-existing refusal; not found; the door held      | `3`  |
 * | a long-running operation still running when the wait ended                 | `4`  |
 * | Google refused or failed; a changed answer shape; a partial write           | `1`  |
 * | read; previewed; or every step sent                                         | `0`  |
 */
import { GoogleAuth } from "googleapis-common";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { type GcpDoorError, GcpDoorErrors } from "../../../gcp/errors.js";
import { type GcpOperationWait, type GcpPlanOutcome, performPlan } from "../../../gcp/execute.js";
import { type GcpWriteOptions, planWrite } from "../../../gcp/operations.js";
import { type GcpWritePlan, gcpWriteDigest, printablePlanView } from "../../../gcp/plan.js";
import { readSecretFile } from "../../../gcp/secretFile.js";
import { encodeSecretPayload } from "../../../gcp/secretPayload.js";
import { type GcpDoorSend, gcpDoorSender } from "../../../gcp/transport.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import {
  editExistingGuard,
  type GcpFamily,
  type GcpWriteInvocation,
  type GcpWriteSpec,
  parseGcpInvocation,
} from "./gcpCore.js";
import {
  heldLines,
  outcomeDocument,
  outcomeLines,
  previewCommand,
  previewLines,
  storeUnavailableLines,
} from "./gcpLines.js";
import { printed, reportError } from "./gcpPrint.js";
import { readProject, runRead } from "./gcpRead.js";
import {
  GCP_ARTIFACTS_USAGE,
  GCP_RUN_USAGE,
  GCP_SECRET_USAGE,
  GCP_SERVICE_ACCOUNT_USAGE,
  GCP_SERVICES_USAGE,
} from "./gcpUsage.js";

/** Each family's usage. */
const USAGE: Readonly<Record<GcpFamily, string>> = {
  artifacts: GCP_ARTIFACTS_USAGE,
  run: GCP_RUN_USAGE,
  secret: GCP_SECRET_USAGE,
  "service-account": GCP_SERVICE_ACCOUNT_USAGE,
  services: GCP_SERVICES_USAGE,
};

/** The scope the owner's Application Default Credential carries. */
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * The seams this verb injects: how the sender is bound, and how a long-running operation is waited on.
 *
 * They exist so preview-sends-nothing and the per-step door rows can be proved at the REAL command boundary
 * with a plain fake sender — a mock would prove only that a different function was not called.
 *
 * @internal
 */
export interface GcpDeps {
  readonly createSend: (args: { project: string }) => GcpDoorSend;
  readonly doorLedger: DoorLedgerPort;
  readonly wait: GcpOperationWait;
}

/** The production seams: the owner's ADC, billed to the project acted on; five-second polls for five minutes. */
const PRODUCTION_DEPS: GcpDeps = {
  createSend: ({ project }) =>
    gcpDoorSender({ auth: new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] }), quotaProject: project }),
  doorLedger: doorLedgerPort(),
  wait: {
    attempts: 60,
    intervalMs: 5000,
    sleep: ({ ms }) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  },
};

/**
 * A write's options, its payload file read and encoded when it has one.
 *
 * @param spec the parsed write
 * @returns the options, or the file or payload refusal
 */
function writeOptions({ spec }: { spec: GcpWriteSpec }): Result<GcpWriteOptions, GcpDoorError> {
  if (spec.kind === "ready") {
    return ok(spec.options);
  }
  if (spec.dataFile === undefined) {
    return spec.command === "secret create"
      ? ok({ command: "secret create", payload: undefined, ...spec.ref })
      : err(GcpDoorErrors.inputInvalid({ why: "secret add-version needs --data-file" }));
  }
  const encoded = readSecretFile({ path: spec.dataFile }).andThen((bytes) => encodeSecretPayload({ bytes }));
  if (encoded.isErr()) {
    return err(encoded.error);
  }
  return ok(
    spec.command === "secret create"
      ? { command: "secret create", payload: encoded.value, ...spec.ref }
      : { command: "secret add-version", payload: encoded.value, ...spec.ref },
  );
}

/**
 * Run one write: plan from a fresh read, guard edit-existing, and either preview or send each step through the
 * door.
 *
 * @returns the exit code
 */
async function runWrite({
  send,
  invocation,
  family,
  rest,
  wait,
  ledger,
}: {
  send: GcpDoorSend;
  invocation: GcpWriteInvocation;
  family: GcpFamily;
  rest: readonly string[];
  wait: GcpOperationWait;
  ledger: DoorLedgerPort;
}): Promise<number> {
  const options = writeOptions({ spec: invocation.spec });
  if (options.isErr()) {
    return reportError({ error: options.error });
  }
  const plan = await planWrite({ options: options.value, send });
  if (plan.isErr()) {
    return reportError({ error: plan.error });
  }
  const digest = gcpWriteDigest({ plan: plan.value });
  // Built once, already cut, so every surface that echoes it — the preview, an approval hold, the door's refusal —
  // gets the cut one.
  const preview = previewCommand({ family, plan: plan.value, rest });
  if (invocation.approve === undefined) {
    return printed({
      json: invocation.json,
      lines: previewLines({ digest, plan: plan.value, preview }),
      value: { digest, plan: printablePlanView({ plan: plan.value }), sent: false },
    });
  }
  const acknowledgements = editExistingGuard({ editExisting: invocation.editExisting, plan: plan.value });
  if (acknowledgements.isErr()) {
    return reportError({ error: acknowledgements.error });
  }
  const outcome = await performPlan({
    acknowledgements: acknowledgements.value,
    approve: invocation.approve,
    digest,
    home: resolveHome({ named: invocation.home }),
    ledger,
    plan: plan.value,
    preview,
    send,
    wait,
  });
  return reportOutcome({ digest, json: invocation.json, outcome, plan: plan.value, preview });
}

/** Print how an approved write ended: a hold on stderr, a failure, or every step's outcome. */
function reportOutcome({
  outcome,
  plan,
  digest,
  preview,
  json,
}: {
  outcome: GcpPlanOutcome;
  plan: GcpWritePlan;
  digest: string;
  preview: string;
  json: boolean;
}): number {
  if (outcome.kind === "held") {
    heldLines({ decision: outcome.decision, plan, preview }).forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  if (outcome.kind === "store-unavailable") {
    storeUnavailableLines({ message: outcome.error.message, plan, preview }).forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (outcome.result.isErr()) {
    return reportError({ error: outcome.result.error });
  }
  return printed({
    json,
    lines: outcomeLines({ outcomes: outcome.result.value, plan }),
    value: outcomeDocument({ digest, outcomes: outcome.result.value, plan }),
  });
}

/**
 * Run one `gcp` family against injected seams.
 *
 * @param family the family the manifest dispatched
 * @param argv the full process argv (the family at index 3)
 * @param deps the sender and the operation wait
 * @returns the process exit code
 * @internal
 */
export async function runGcpWith({
  family,
  argv,
  deps,
}: {
  family: GcpFamily;
  argv: readonly string[];
  deps: GcpDeps;
}): Promise<number> {
  const rest = verbTail({ argv, verbs: [family] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE[family] });
    return EXIT_OK;
  }
  const parsed = parseGcpInvocation({ family, rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: USAGE[family] });
    return EXIT_USAGE;
  }
  const invocation = parsed.value;
  if (invocation.kind === "read") {
    const send = deps.createSend({ project: readProject({ options: invocation.options }) });
    return runRead({ json: invocation.json, options: invocation.options, send });
  }
  const project = invocation.spec.kind === "ready" ? invocation.spec.options.project : invocation.spec.ref.project;
  return runWrite({
    family,
    invocation,
    ledger: deps.doorLedger,
    rest,
    send: deps.createSend({ project }),
    wait: deps.wait,
  });
}

/** `gcp run`. */
export const gcpRunCommand = defineCommand({
  run: (argv) => runGcpWith({ argv, deps: PRODUCTION_DEPS, family: "run" }),
});

/** `gcp secret`. */
export const gcpSecretCommand = defineCommand({
  run: (argv) => runGcpWith({ argv, deps: PRODUCTION_DEPS, family: "secret" }),
});

/** `gcp service-account`. */
export const gcpServiceAccountCommand = defineCommand({
  run: (argv) => runGcpWith({ argv, deps: PRODUCTION_DEPS, family: "service-account" }),
});

/** `gcp services`. */
export const gcpServicesCommand = defineCommand({
  run: (argv) => runGcpWith({ argv, deps: PRODUCTION_DEPS, family: "services" }),
});

/** `gcp artifacts`. */
export const gcpArtifactsCommand = defineCommand({
  run: (argv) => runGcpWith({ argv, deps: PRODUCTION_DEPS, family: "artifacts" }),
});
