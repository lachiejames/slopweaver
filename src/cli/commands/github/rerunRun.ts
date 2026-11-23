/** Effectful shell for the governed re-run of a workflow run's failed jobs. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { doorRefusalLines, notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubRerunApi, makeGithubRerunApi, type WorkflowRunState } from "../../../outbound/github/rerun.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type GithubVerbError, GithubVerbErrors, githubVerbErrorLines } from "./errors.js";
import {
  attemptAdvanced,
  type GithubRerunArgs,
  parseGithubRerunArgs,
  rerunDoorRequest,
  rerunVerdict,
  runLabel,
  sendOutcomeUnknown,
  supersedingRun,
} from "./rerunCore.js";
import { GITHUB_RERUN_USAGE } from "./rerunUsage.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubRerunDeps {
  /** The door ledger each re-run's decision is recorded through before it is sent. */
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubRerunApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** One run's outcome, as printed and as emitted under `--json`. */
interface RunOutcome {
  readonly id: number;
  readonly name: string;
  readonly url: string;
  readonly outcome:
    "re-ran" | "would re-run" | "nothing failed" | "still running" | "superseded" | "cannot re-run" | "refused";
  readonly attempt: number | undefined;
  /** The conclusion, status or upstream refusal behind the outcome; null when there is nothing to add. */
  readonly detail: string | null;
  /** The door's own refusal, line by line as `doorRefusalLines` renders it; absent when the door admitted it. */
  readonly doorRefusal?: readonly string[];
}

/** The state home: `--home` when given, else the resolved default. */
function homeOf({ args, deps }: { args: GithubRerunArgs; deps: GithubRerunDeps }): string {
  if (args.home !== undefined) {
    return args.home;
  }
  return deps.home();
}

/** Wrap a provider failure as this verb directory's own error. */
function upstream({ operation, message }: { operation: string; message: string }): GithubVerbError {
  return GithubVerbErrors.upstreamRefused({ operation, reasons: [message] });
}

/** The runs this invocation is about — the one named, or every run on the pull request's current head. */
async function runsInScope({
  api,
  args,
}: {
  api: GithubRerunApi;
  args: GithubRerunArgs;
}): Promise<Result<readonly WorkflowRunState[], GithubVerbError>> {
  const { owner, repo, target } = args;
  if (target.kind === "run") {
    const run = await api.run({ owner, repo, runId: target.runId });
    return run.isErr() ? err(upstream({ message: run.error.message, operation: "read run" })) : ok([run.value]);
  }
  const head = await api.prHeadSha({ number: target.number, owner, repo });
  if (head.isErr()) {
    return err(upstream({ message: head.error.message, operation: "read pull request" }));
  }
  const listed = await api.runsForHead({ headSha: head.value, owner, repo });
  if (listed.isErr()) {
    return err(upstream({ message: listed.error.message, operation: "list runs" }));
  }
  if (listed.value.truncated) {
    return err(GithubVerbErrors.runsUnverifiable({ sha: head.value }));
  }
  return ok(listed.value.runs);
}

/**
 * Send the re-run once, then read the run back and confirm GitHub started a new attempt. A send that failed
 * without a definite answer is read back too, because a timeout can lose the answer to a write GitHub
 * accepted: an attempt that advanced anyway is a re-run, and only one that did not is the send's failure.
 */
async function rerunAndConfirm({
  api,
  args,
  before,
}: {
  api: GithubRerunApi;
  args: GithubRerunArgs;
  before: WorkflowRunState;
}): Promise<Result<WorkflowRunState, GithubVerbError>> {
  const { owner, repo } = args;
  const sent = await api.rerunFailed({ owner, repo, runId: before.id });
  if (sent.isErr()) {
    if (sendOutcomeUnknown({ error: sent.error })) {
      const reread = await api.run({ owner, repo, runId: before.id });
      if (reread.isOk() && attemptAdvanced({ after: reread.value, before })) {
        return ok(reread.value);
      }
    }
    return err(upstream({ message: sent.error.message, operation: "re-run failed jobs" }));
  }
  const after = await api.run({ owner, repo, runId: before.id });
  if (after.isErr()) {
    return err(upstream({ message: after.error.message, operation: "read run back" }));
  }
  if (!attemptAdvanced({ after: after.value, before })) {
    return err(
      GithubVerbErrors.rerunUnconfirmed({ attempt: String(after.value.runAttempt), run: runLabel({ run: before }) }),
    );
  }
  return ok(after.value);
}

/** The outcome record for one run, before any write. */
function outcomeOf({
  run,
  outcome,
  detail,
  doorRefusal,
}: {
  run: WorkflowRunState;
  outcome: RunOutcome["outcome"];
  detail: string | null;
  doorRefusal?: readonly string[];
}): RunOutcome {
  return {
    attempt: run.runAttempt,
    detail,
    ...(doorRefusal === undefined ? {} : { doorRefusal }),
    id: run.id,
    name: run.name,
    outcome,
    url: run.htmlUrl,
  };
}

/** Re-run one failed run through the door, and say what happened to it. */
async function rerunOne({
  api,
  args,
  home,
  ledger,
  run,
}: {
  api: GithubRerunApi;
  args: GithubRerunArgs;
  home: string;
  ledger: DoorLedgerPort;
  run: WorkflowRunState;
}): Promise<RunOutcome> {
  if (args.dryRun) {
    return outcomeOf({ detail: run.conclusion, outcome: "would re-run", run });
  }
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger,
    perform: () => rerunAndConfirm({ api, args, before: run }),
    request: rerunDoorRequest({ args, home, runId: run.id }),
  });
  if (!through.performed) {
    if (through.kind === "recording-refused") {
      // Not a policy refusal: the door passed it and the audit trail could not take the row, so `detail` carries why.
      const detail = notPerformedLines({ command: "slopweaver github rerun", through }).join("; ");
      return outcomeOf({ detail, outcome: "refused", run });
    }
    const doorRefusal = doorRefusalLines({ command: "slopweaver github rerun", decision: through.decision });
    return outcomeOf({ detail: null, doorRefusal, outcome: "refused", run });
  }
  if (through.result.isErr()) {
    return outcomeOf({
      detail: githubVerbErrorLines({ error: through.result.error }).join("; "),
      outcome: "refused",
      run,
    });
  }
  return outcomeOf({ detail: null, outcome: "re-ran", run: through.result.value });
}

/**
 * One outcome as the text the report prints: a single line, or — for a door refusal — the run's line
 * followed by the refusal's own lines, so no refusal sits inside a parenthesis. Keyed on the door having
 * refused rather than on a newline, so an upstream error that carries one prints exactly as it always did.
 */
function outcomeLine({ outcome }: { outcome: RunOutcome }): string {
  const attempt = outcome.attempt === undefined ? "" : `  attempt ${String(outcome.attempt)}`;
  const head = `${outcome.outcome}  ${outcome.name} (run ${String(outcome.id)})${attempt}`;
  if (outcome.doorRefusal !== undefined) {
    return [`${head}  ${outcome.url}`, ...outcome.doorRefusal].join("\n");
  }
  const detail = outcome.detail === null ? "" : `  (${outcome.detail})`;
  return `${head}${detail}  ${outcome.url}`;
}

/**
 * Run the re-run.
 *
 * @param rest argv after `github rerun`
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubRerun({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubRerunDeps;
}): Promise<number> {
  const parsed = parseGithubRerunArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(GITHUB_RERUN_USAGE);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = homeOf({ args, deps });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic(GithubVerbErrors.githubTokenMissing().message);
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const scoped = await runsInScope({ api, args });
  if (scoped.isErr()) {
    githubVerbErrorLines({ error: scoped.error }).forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  const outcomes: RunOutcome[] = [];
  for (const run of scoped.value) {
    outcomes.push(await outcomeFor({ api, args, home, ledger: deps.doorLedger, run, runs: scoped.value }));
  }
  report({ args, deps, outcomes });
  return exitOf({ args, outcomes });
}

/**
 * What happens to one run in scope. A run a newer one of its workflow replaced is left alone on a pull
 * request's head, never on a run named by id — that caller chose it.
 */
async function outcomeFor({
  api,
  args,
  home,
  ledger,
  run,
  runs,
}: {
  api: GithubRerunApi;
  args: GithubRerunArgs;
  home: string;
  ledger: DoorLedgerPort;
  run: WorkflowRunState;
  runs: readonly WorkflowRunState[];
}): Promise<RunOutcome> {
  const newer = args.target.kind === "pr" ? supersedingRun({ run, runs }) : undefined;
  if (newer !== undefined) {
    return outcomeOf({
      detail: `run ${String(newer.id)} of the same workflow replaced it`,
      outcome: "superseded",
      run,
    });
  }
  const verdict = rerunVerdict({ run });
  if (verdict === "rerun") {
    return rerunOne({ api, args, home, ledger, run });
  }
  if (verdict === "not-completed") {
    const detail = `${String(run.status)} — GitHub re-runs only a finished run; wait for it, then re-run`;
    return outcomeOf({ detail, outcome: "still running", run });
  }
  if (verdict === "not-rerunnable") {
    const detail = `${String(run.conclusion)} — it has no failed jobs to re-run; open the run to see why`;
    return outcomeOf({ detail, outcome: "cannot re-run", run });
  }
  return outcomeOf({ detail: run.conclusion, outcome: "nothing failed", run });
}

/** Print every run's outcome, or say plainly that the pull request's head has nothing failed. */
function report({
  args,
  deps,
  outcomes,
}: {
  args: GithubRerunArgs;
  deps: GithubRerunDeps;
  outcomes: readonly RunOutcome[];
}): void {
  if (args.json) {
    deps.out(JSON.stringify({ repo: `${args.owner}/${args.repo}`, runs: outcomes }, undefined, 2));
    return;
  }
  if (outcomes.length === 0) {
    deps.out("nothing to re-run: no workflow run has started on that pull request's head commit");
    return;
  }
  outcomes.forEach((outcome) => {
    deps.out(outcomeLine({ outcome }));
  });
}

/**
 * The exit code a set of outcomes earns. A refused write is an error, and so is a run that is neither clean
 * nor re-runnable, so no caller reads one as green. A named run that is still going is a refusal too — the
 * caller asked for that run and it could not be re-run — while a pull request's in-progress run beside its
 * failed ones is simply reported.
 */
function exitOf({ args, outcomes }: { args: GithubRerunArgs; outcomes: readonly RunOutcome[] }): number {
  if (outcomes.some((outcome) => outcome.outcome === "refused" || outcome.outcome === "cannot re-run")) {
    return EXIT_ERROR;
  }
  if (args.target.kind === "run" && outcomes.some((outcome) => outcome.outcome === "still running")) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-client and output edges for the re-run command
 */
export function productionGithubRerunDeps(): GithubRerunDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubRerunApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github rerun`. */
export const githubRerunCommand = defineCommand({
  run: (argv) => runGithubRerun({ deps: productionGithubRerunDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
