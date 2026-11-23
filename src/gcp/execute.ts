/**
 * Performing an approved plan: every step through the door on its own, in order, each answer read through its
 * strict boundary, every long-running operation waited on, and a stop part way reported as exactly that.
 *
 * ## One door row per step
 *
 * A deploy that creates a service and then grants its public invoker is two writes, and the ledger records two
 * decisions under one digest, so a reader of the store's `door_event` rows sees each write that was attempted rather than
 * one line standing for both. A row records ADMISSION, not success (`../admit/effects.ts` records before it
 * performs): what Google did is this module's output, not the ledger's.
 *
 * ## Nothing is rolled back, and nothing is re-sent
 *
 * A step that fails after an earlier one succeeded answers `PARTIAL_WRITE` naming what was done. Undoing it
 * would be a delete, which this door has no member for. A long-running operation still running when the wait
 * ends answers `OPERATION_DEFERRED`, the write sent once and never again: reading the resource is safe,
 * re-sending a create is not.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { DoorLedgerPort } from "../admit/doorLedgerPort.js";
import type { DoorStoreError } from "../admit/doorStoreErrors.js";
import { throughDoor } from "../admit/effects.js";
import type { DoorAcknowledgement, DoorDecision } from "../admit/types.js";

import { gcpWriteApprovalGate } from "./approval.js";
import { listSecretVersions } from "./describe.js";
import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { performGrant } from "./executeGrant.js";
import { type GcpWritePlan, type GcpWriteStep, planUnprintable } from "./plan.js";
import { cutMessage, cutValues } from "./redact.js";
import type { GcpDoorRequest, GcpOperationProvider } from "./request.js";
import { callGcp, type GcpDoorSend, redactedDetail } from "./transport.js";
import { OPERATION, SECRET, SECRET_VERSION, SERVICE_ACCOUNT } from "./wire.js";

/** How long the door waits on a long-running operation, and the sleep it waits with. */
export interface GcpOperationWait {
  readonly sleep: (args: { ms: number }) => Promise<void>;
  readonly intervalMs: number;
  readonly attempts: number;
}

/** What one performed step reports. */
export interface GcpStepOutcome {
  readonly id: string;
  /** What Google now holds, as one line: the resource name, its state, or the operation that finished. */
  readonly detail: string;
}

/** Which provider's operation a write answers with, or null for a write that answers the resource itself. */
function operationProvider({ request }: { request: GcpDoorRequest }): GcpOperationProvider | null {
  switch (request.kind) {
    case "run-service-create":
    case "run-service-patch":
      return "run";
    case "api-service-enable":
      return "serviceusage";
    case "repository-create":
      return "artifactregistry";
    case "run-service-get":
    case "run-iam-get":
    case "run-iam-set":
    case "secret-get":
    case "secret-create":
    case "secret-version-list":
    case "secret-version-add":
    case "secret-version-disable":
    case "secret-version-get":
    case "secret-version-access":
    case "secret-iam-get":
    case "secret-iam-set":
    case "service-account-get":
    case "service-account-create":
    case "api-service-get":
    case "repository-get":
    case "operation-get":
      return null;
  }
}

/**
 * A finished operation's failure, its message cut against the write that started it: an operation answers HTTP
 * success with the error inside, so the transport's own redaction never saw it, and Google may quote the
 * write's body — a deploy's carried env values — back in it.
 *
 * @param write the write that started the operation
 * @param name the operation's name
 * @param message Google's message, if it gave one
 * @returns `OPERATION_FAILED`, safe to print
 */
function operationFailure({
  write,
  name,
  message,
}: {
  write: GcpDoorRequest;
  name: string;
  message: string | undefined;
}): GcpDoorError {
  const detail = message === undefined ? "no message" : redactedDetail({ detail: message, request: write });
  return GcpDoorErrors.operationFailed({ detail, operation: name });
}

/**
 * Wait on one long-running operation until it is done, failed, or the wait ends.
 *
 * @param send the sender
 * @param write the write that started it, which its failure text is redacted against
 * @param provider whose operation it is
 * @param name the operation's name
 * @param wait the bound
 * @returns the operation name once done, or `OPERATION_FAILED` / `OPERATION_DEFERRED`
 */
async function awaitOperation({
  send,
  write,
  provider,
  name,
  wait,
}: {
  send: GcpDoorSend;
  write: GcpDoorRequest;
  provider: GcpOperationProvider;
  name: string;
  wait: GcpOperationWait;
}): Promise<Result<string, GcpDoorError>> {
  for (let attempt = 0; attempt < wait.attempts; attempt += 1) {
    const read = await callGcp({ boundary: OPERATION, request: { kind: "operation-get", name, provider }, send });
    if (read.isErr()) {
      return err(read.error);
    }
    if (read.value.error !== undefined) {
      return err(operationFailure({ message: read.value.error.message, name, write }));
    }
    if (read.value.done === true) {
      return ok(name);
    }
    await wait.sleep({ ms: wait.intervalMs });
  }
  return err(GcpDoorErrors.operationDeferred({ operation: name }));
}

/**
 * Send one fixed write and read its answer: the resource it made, or the operation it started, waited on.
 *
 * @param send the sender
 * @param request the write
 * @param wait the operation bound
 * @returns one line naming what Google now holds
 */
async function sendWrite({
  send,
  request,
  wait,
}: {
  send: GcpDoorSend;
  request: GcpDoorRequest;
  wait: GcpOperationWait;
}): Promise<Result<string, GcpDoorError>> {
  const provider = operationProvider({ request });
  if (provider !== null) {
    const started = await callGcp({ boundary: OPERATION, request, send });
    if (started.isErr()) {
      return err(started.error);
    }
    if (started.value.error !== undefined) {
      return err(operationFailure({ message: started.value.error.message, name: started.value.name, write: request }));
    }
    if (started.value.done === true) {
      return ok(`operation ${started.value.name} done`);
    }
    return (await awaitOperation({ name: started.value.name, provider, send, wait, write: request })).map(
      (name) => `operation ${name} done`,
    );
  }
  switch (request.kind) {
    case "secret-create":
      return (await callGcp({ boundary: SECRET, request, send })).map((secret) => `created ${secret.name}`);
    case "secret-version-add":
    case "secret-version-disable":
      return (await callGcp({ boundary: SECRET_VERSION, request, send })).map(
        (version) => `${version.name} is ${String(version.state)}`,
      );
    case "service-account-create":
      return (await callGcp({ boundary: SERVICE_ACCOUNT, request, send })).map((account) => `created ${account.email}`);
    case "run-service-get":
    case "run-service-create":
    case "run-service-patch":
    case "run-iam-get":
    case "run-iam-set":
    case "secret-get":
    case "secret-version-list":
    case "secret-version-get":
    case "secret-version-access":
    case "secret-iam-get":
    case "secret-iam-set":
    case "service-account-get":
    case "api-service-get":
    case "api-service-enable":
    case "repository-get":
    case "repository-create":
    case "operation-get":
      return err(GcpDoorErrors.requestRefused({ what: request.kind, why: "not a write a plan step may send" }));
  }
}

/**
 * Re-list a secret's versions right before an ADDITIVE version add, and refuse if one has been enabled since the
 * plan read them. `:addVersion` takes no precondition, so without this an add planned beside no enabled version
 * would still move `latest` off one enabled in between, under a door row that says `additive` and carries no
 * reason. The re-read narrows that window to the gap between this list and the send; it cannot close it.
 *
 * @param send the sender
 * @param request the version add about to be sent
 * @returns nothing when no version is enabled, or the refusal
 */
async function stillNoEnabledVersion({
  send,
  request,
}: {
  send: GcpDoorSend;
  request: Extract<GcpDoorRequest, { kind: "secret-version-add" }>;
}): Promise<Result<void, GcpDoorError>> {
  const versions = await listSecretVersions({ ref: { project: request.project, secret: request.secret }, send });
  if (versions.isErr()) {
    return err(versions.error);
  }
  if (versions.value.some((version) => version.state === "ENABLED")) {
    return err(
      GcpDoorErrors.requestRefused({
        what: `a version add to projects/${request.project}/secrets/${request.secret}`,
        why: "a version was enabled since the plan was read, so this add would now move `latest` — preview again",
      }),
    );
  }
  return ok(undefined);
}

/**
 * Perform one step's effect.
 *
 * @param send the sender
 * @param step the step
 * @param wait the operation bound
 * @returns the outcome, or the failure
 */
async function performStep({
  send,
  step,
  wait,
}: {
  send: GcpDoorSend;
  step: GcpWriteStep;
  wait: GcpOperationWait;
}): Promise<Result<GcpStepOutcome, GcpDoorError>> {
  if (
    step.classification === "additive" &&
    step.action.kind === "send" &&
    step.action.request.kind === "secret-version-add"
  ) {
    const still = await stillNoEnabledVersion({ request: step.action.request, send });
    if (still.isErr()) {
      return err(still.error);
    }
  }
  const performed =
    step.action.kind === "grant"
      ? await performGrant({ action: step.action, send })
      : await sendWrite({ request: step.action.request, send, wait });
  return performed.map((detail) => ({ detail, id: step.id }));
}

/** A failed step's end: its own error when nothing was sent before it, else a partial write naming what was. */
function stepFailure({
  done,
  failed,
  failure,
}: {
  done: readonly GcpStepOutcome[];
  failed: string;
  failure: GcpDoorError;
}): GcpDoorError {
  if (done.length === 0) {
    return failure;
  }
  return GcpDoorErrors.partialWrite({
    cause: failure.message,
    done: done.map((outcome) => `${outcome.id} (${outcome.detail})`),
    failed,
  });
}

/**
 * How an approved plan ended. `held` is POLICY (the door warned or held a step); `store-unavailable` is
 * INFRASTRUCTURE (the step's decision could not be recorded, so it was not sent) and is never reported as a hold.
 */
export type GcpPlanOutcome =
  | { readonly kind: "held"; readonly decision: DoorDecision }
  | { readonly kind: "store-unavailable"; readonly decision: DoorDecision; readonly error: DoorStoreError }
  | { readonly kind: "done"; readonly result: Result<readonly GcpStepOutcome[], GcpDoorError> };

/**
 * Perform every step of an approved plan, each through the door, stopping at the first that is held or fails.
 *
 * @param plan the plan, rebuilt from a fresh read
 * @param digest that plan's digest
 * @param approve what `--approve` carried
 * @param acknowledgements the `--edit-existing` reason, when the plan holds an edit-existing step
 * @param home the state home whose door ledger records each step
 * @param ledger the door ledger each step's decision is recorded through
 * @param preview the command that prints the preview again
 * @param send the sender
 * @param wait the operation bound
 * @returns `held` with the door's decision, `store-unavailable` when a step could not be recorded, or `done` with
 *   every outcome or the failure
 */
export async function performPlan({
  plan,
  digest,
  approve,
  acknowledgements,
  home,
  ledger,
  preview,
  send,
  wait,
}: {
  plan: GcpWritePlan;
  digest: string;
  approve: string;
  acknowledgements: readonly DoorAcknowledgement[];
  home: string;
  ledger: DoorLedgerPort;
  preview: string;
  send: GcpDoorSend;
  wait: GcpOperationWait;
}): Promise<GcpPlanOutcome> {
  // Everything handed back is cut against the plan's values, so no Google-returned name or message — an operation
  // name included — can carry one to stdout or `--json`, however unlikely the match.
  const values = planUnprintable({ plan });
  const done: GcpStepOutcome[] = [];
  for (const step of plan.steps) {
    const routed = await throughDoor({
      gates: [gcpWriteApprovalGate({ expected: digest, preview, supplied: approve })],
      home,
      ledger,
      perform: () => performStep({ send, step, wait }),
      request: {
        // The step id rides the action so each row names the write it admitted: `verb:gcp.secret create add-version`.
        action: { kind: "verb", noun: "gcp", verb: `${plan.command} ${step.id}` },
        artifact: {
          classification: step.classification,
          digest,
          operation: step.id,
          project: plan.project,
          target: plan.target,
        },
        meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },
        ...(acknowledgements.length > 0 ? { acknowledgements } : {}),
      },
    });
    if (routed.kind === "recording-refused") {
      return { decision: routed.decision, error: routed.error, kind: "store-unavailable" };
    }
    if (!routed.performed) {
      return { decision: routed.decision, kind: "held" };
    }
    if (routed.result.isErr()) {
      const failure = cutMessage({ error: routed.result.error, values });
      return { kind: "done", result: err(stepFailure({ done, failed: step.id, failure })) };
    }
    done.push({ ...routed.result.value, detail: cutValues({ text: routed.result.value.detail, values }) });
  }
  return { kind: "done", result: ok(done) };
}
