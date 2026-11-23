/**
 * The SECOND `read-only-subagent` call of `slopweaver turn dispatch` — `--subagent-report <file>` — cut out
 * of `dispatch.ts`, which keeps the judgement, the first call and every other mode. The lease is reloaded from
 * the ask-lifecycle log rather than trusted from the caller, the evidence file is parsed into
 * `ExecutionEvidence`, and the tier runs through `executeTier` with that evidence as its adapter, so an
 * expired lease is refused by the same code that would refuse it on a live subagent.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { askLifecycleKey, foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, readAskLifecycleText } from "../../../live/ask/store.js";
import {
  type ExecutionEvidence,
  parseExecutionEvidence,
  type ReadOnlySubagentOutcome,
} from "../../../live/turn/subagent.js";
import { executeTier, type RespondDecision, type TierDeps } from "../../../live/turn/tier.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { readOrReport, refuse } from "./core.js";
import { neverCalled } from "./dispatchFreshSession.js";
import { type TurnCommandError, TurnCommandErrors, turnCommandErrorLines } from "./errors.js";

/** The still-open `read-only-subagent` dispatch's own recorded lease, or the one reason none is open. */
function openSubagentLease({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): Result<string, TurnCommandError> {
  const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
  // `activeDispatch` rather than `state`, for the same reason the sweep reads it: an observation appended
  // over a live dispatch moves `state` without ending the dispatch.
  const dispatched = folded.get(askLifecycleKey({ askIdentity }))?.activeDispatch;
  if (dispatched?.tier !== "read-only-subagent") {
    return err(TurnCommandErrors.subagentDispatchMissing());
  }
  return ok(dispatched.leaseExpiresAt);
}

/** Read and parse a subagent's evidence report file. */
function readEvidenceReport({ reportPath }: { reportPath: string }): Result<ExecutionEvidence, TurnCommandError> {
  const reportText = readOrReport({ path: reportPath, what: "subagent report" });
  if (reportText.isErr()) {
    return err(reportText.error);
  }
  let rawReport: unknown;
  try {
    rawReport = JSON.parse(reportText.value);
  } catch (error) {
    return err(TurnCommandErrors.documentNotJson({ cause: error, what: "subagent report" }));
  }
  return parseExecutionEvidence({ value: rawReport }).mapErr((reasons) =>
    TurnCommandErrors.upstreamRefused({ reasons }),
  );
}

/**
 * The wall clock as an ISO instant, sampled each time it is called — once when the tier judges the lease, and
 * again when an expired lease is recorded.
 *
 * @internal exported so its test can drive {@link handleSubagentReport} on a fixed clock.
 */
export type SubagentReportClock = () => string;

/** Run the read-only-subagent tier through {@link executeTier}, with the report-backed evidence as its adapter. */
async function executeReportBackedSubagent({
  askIdentity,
  evidence,
  leaseExpiresAt,
  nowIso,
}: {
  askIdentity: AskIdentity;
  evidence: ExecutionEvidence;
  leaseExpiresAt: string;
  nowIso: SubagentReportClock;
}) {
  const deps: TierDeps = {
    launchVisibleSession: neverCalled({ what: "launchVisibleSession" }),
    nowIso,
    subagent: async (): Promise<ReadOnlySubagentOutcome> => ({ evidence, kind: "returned" }),
  };
  return executeTier({
    deps,
    request: {
      ask: askIdentity,
      kind: "read-only-subagent",
      leaseExpiresAt,
      task: { ask: askIdentity, instructions: "" },
    },
  });
}

/**
 * Handle the SECOND `read-only-subagent` call: reload the lease from the ask-lifecycle log, then execute.
 *
 * @param nowIso the clock, called where the lease is judged and again where its expiry is recorded
 * @returns the process exit code — `EXIT_OK` once the evidence is accepted, `EXIT_ERROR` on any refusal
 */
export async function handleSubagentReport({
  askIdentity,
  briefPath,
  decision,
  decisionPath,
  home,
  nowIso = () => new Date().toISOString(),
  reportPath,
}: {
  askIdentity: AskIdentity;
  briefPath: string;
  decision: RespondDecision;
  decisionPath: string;
  home: string;
  nowIso?: SubagentReportClock;
  reportPath: string;
}): Promise<number> {
  if (decision.tier !== "read-only-subagent") {
    return refuse({
      code: EXIT_ERROR,
      errors: ["--subagent-report was given, but the decision's tier is not read-only-subagent"],
    });
  }
  const lease = openSubagentLease({ askIdentity, home });
  if (lease.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: lease.error }) });
  }
  const evidence = readEvidenceReport({ reportPath });
  if (evidence.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: evidence.error }) });
  }
  const result = await executeReportBackedSubagent({
    askIdentity,
    evidence: evidence.value,
    leaseExpiresAt: lease.value,
    nowIso,
  });
  if (result.kind === "lease-expired") {
    appendAskLifecycleEvent({
      event: { ...askIdentity, kind: "lease-expired", tsIso: nowIso() },
      home,
    });
    return refuse({
      code: EXIT_ERROR,
      errors: ["the read-only-subagent dispatch's lease expired — re-judge this ask"],
    });
  }
  if (result.kind === "failed") {
    return refuse({ code: EXIT_ERROR, errors: [result.reason] });
  }
  logger.out({ line: "subagent evidence accepted — compose the answer now, then run:" });
  logger.out({
    line: `  slopweaver turn answer --brief ${briefPath} --decision ${decisionPath} --answer <answer-file.json>`,
  });
  return EXIT_OK;
}
