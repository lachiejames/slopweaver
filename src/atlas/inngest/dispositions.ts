/**
 * What this atlas may do with each published operation, decided by REVIEWED RULES rather than one by one.
 *
 * ## The criterion is `docs/atlas-intent/06-holdings.md`'s, applied per operation
 *
 * A family is voluminous when its records are time-series OBSERVATIONS — emitted by the platform rather than
 * created by a person, unbounded, growing with the clock, identified by an instant rather than by a name
 * somebody chose. Configuration is the complement: what a person or a system CREATED, listable exhaustively.
 *
 * The rule cuts THROUGH a family rather than along it, and Inngest is a sharp example. `ListEvents` returns
 * events the platform received — observations, voluminous. `ListInsightsEventSchemas` returns the SHAPE of
 * each event type, which is a thing a codebase declared and can be listed exhaustively — configuration, and
 * an entity. Same product area, opposite dispositions. A rule stated as a list of families could not express
 * that.
 *
 * ## Every rule must FIRE, or the sync says so
 *
 * A reviewed rule matching nothing reads as considered judgement and is not one — a catalogue rename would
 * silently retire a rule and nothing would notice. So each rule carries an id, the sync counts what each
 * matched, and one that matched nothing raises `disposition-rule-never-fired`.
 */
import type { InngestDisposition } from "./model.js";
import type { InngestCatalogueOperation } from "./restCatalogue.js";

/** One reviewed rule: what it matches, what that earns, and why. */
export interface InngestDispositionRule {
  readonly disposition: InngestDisposition;
  readonly id: string;
  /** Whether this rule claims one operation. Pure, so the whole table is testable without a network. */
  readonly matches: (input: { operation: InngestCatalogueOperation }) => boolean;
  readonly reason: string;
}

/** Operation ids whose own act creates, changes or destroys something on this account. */
const MUTATING_OPERATION_IDS = new Set([
  "CancelRun",
  "CreateCancellation",
  "CreateEnv",
  "CreatePartnerAccount",
  "CreateSandbox",
  "CreateScore",
  "CreateWebhook",
  "DeleteCancellation",
  "DeleteWebhook",
  "DestroySandbox",
  "ExecSandbox",
  "InvokeFunction",
  "PatchEnv",
  "QueryInsights",
  "QueryInsightsPrompt",
  "Rerun",
  "ResumeSignal",
  "SendEvent",
  "SignalSandboxProcess",
  "StartSandboxProcess",
  "SyncApp",
  "UpdateWebhook",
  "WriteSandboxFile",
]);

/**
 * Operation ids returning time-series observations.
 *
 * Each is identified by an instant rather than by a name somebody chose: a run, an event, a trace, a job, a
 * log line, a score aggregate over a window. `GetRunJobs` is here for a reason its own description states —
 * Inngest documents it as returning "a subset of the function run's jobs", rate limited and cached, which is
 * a platform saying its own family is unbounded.
 */
const VOLUMINOUS_OPERATION_IDS = new Set([
  "GetEvent",
  "GetEventRuns",
  "GetExperiment",
  "GetFunctionRun",
  "GetFunctionTrace",
  "GetRun",
  "GetRunJobs",
  "GetSandboxProcessOutput",
  "ListEventRuns",
  "ListEvents",
  "ListFunctionRuns",
  "ListRuns",
  "ListSessionRuns",
  "ListSessions",
  "StreamSandboxLogs",
  "StreamSandboxProcessOutput",
  "WaitSandboxProcess",
]);

/**
 * The reviewed rules, in the order they are applied.
 *
 * Order is load-bearing where an operation could match two: a mutation that also returns observations is
 * EXCLUDED rather than voluminous, because the reason this atlas will not call it is the write, and grading
 * it voluminous would say it was looked at and deliberately not kept.
 */
export const INNGEST_DISPOSITION_RULES: readonly InngestDispositionRule[] = [
  {
    disposition: "excluded",
    id: "mutating-operation",
    matches: ({ operation }) => MUTATING_OPERATION_IDS.has(operation.operationId),
    reason:
      "the operation creates, changes, destroys or executes something on this account, and this atlas only " +
      "ever reads. It is held as a row because an atlas that omitted it would answer that Inngest offers no " +
      "way to do this, which is false",
  },
  {
    disposition: "excluded",
    id: "sandbox-filesystem-read",
    matches: ({ operation }) => operation.operationId === "ReadSandboxFile",
    reason:
      "reading a file out of a running sandbox returns BYTES of somebody's workload rather than the shape " +
      "of the platform, and this atlas maps where a thing is rather than mirroring it",
  },
  {
    disposition: "voluminous",
    id: "time-series-observation",
    matches: ({ operation }) => VOLUMINOUS_OPERATION_IDS.has(operation.operationId),
    reason:
      "its records are time-series observations — emitted by the platform, identified by an instant rather " +
      "than by a name somebody chose, and growing with the clock. The operation is enumerated and declared; " +
      "its rows are never stored whole (docs/atlas-intent/06-holdings.md)",
  },
  {
    disposition: "reachable",
    id: "configuration-read",
    matches: () => true,
    reason:
      "it returns configuration somebody or something CREATED — an app, a function definition, an " +
      "environment, a key, an event type's schema, a webhook — which can be listed exhaustively, so the " +
      "atlas may call it once a credential exists and stores what it returns",
  },
];

/** What one rule decided, so the sync can report a rule that matched nothing. */
export interface InngestDispositionVerdict {
  readonly disposition: InngestDisposition;
  readonly reason: string;
  readonly ruleId: string;
}

/**
 * Apply the reviewed rules to one operation.
 *
 * @param operation the catalogued operation
 * @returns the first rule's verdict; the table's last rule matches everything, so this never fails
 */
export function inngestDispositionFor({
  operation,
}: {
  operation: InngestCatalogueOperation;
}): InngestDispositionVerdict {
  for (const rule of INNGEST_DISPOSITION_RULES) {
    if (rule.matches({ operation })) {
      return { disposition: rule.disposition, reason: rule.reason, ruleId: rule.id };
    }
  }
  // The final rule matches everything, so this is unreachable; stated rather than thrown so the function
  // stays total for a caller.
  return {
    disposition: "reachable",
    reason: "no reviewed rule claimed this operation",
    ruleId: "unclaimed",
  };
}
