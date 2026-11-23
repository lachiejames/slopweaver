/**
 * The effectful shell for `slopweaver linear move-issues`: read live, plan (`./moveIssuesCore.ts`), and under
 * `--apply` write each move through the `linear issue` verb itself, in-process.
 *
 * In-process rather than a second write path on purpose: `runLinearIssue` already
 * holds the retired-team gate, the state-catalog gate, the door, the pre-write existence read and the
 * read-back, and a batch verb that rebuilt them would be a second Linear write architecture to keep in step.
 * Its output is captured rather than printed, so `--json` stays one document.
 *
 * A preview writes nothing, not even the state catalog. `--apply` records the destination's states as the
 * door's evidence immediately before the first write, because `linear issue` refuses a `stateId` the catalog
 * has never seen and this verb's own read is that evidence.
 */

import { errorMessage } from "#lib/errorMessage.js";
import { linearToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "../../../live/linear/errors.js";
import { type LinearIssueMoveInputs, readLinearIssueMoveInputs } from "../../../live/linear/issueMoveRead.js";
import { type LinearStatesDocument, linearStatesRequest } from "../../../live/linear/states.js";
import type { LinearIssueForm } from "../../../outbound/linear/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { linearVerbErrorLines } from "./errors.js";
import {
  type IssueMoveApplication,
  type IssueMovePlan,
  parseLinearMoveIssuesArgs,
  planExitCode,
  planIssueMoves,
} from "./moveIssuesCore.js";
import { moveIssuesJson, moveIssuesTextLines } from "./moveIssuesReport.js";
import { LINEAR_MOVE_ISSUES_USAGE } from "./moveIssuesUsage.js";
import { runLinearIssue } from "./run.js";
import { recordLinearStates } from "./statesRun.js";
import { productionLinearWriteDeps } from "./writeDeps.js";

const VERB_ARG_OFFSET = 4;

/** What one in-process `linear issue update` returned, its printed lines captured. */
export interface IssueMoveInvocationResult {
  readonly exitCode: number;
  readonly output: readonly string[];
  readonly diagnostics: readonly string[];
}

/** Injectable command edges. Plain fakes exercise the shell without the Linear SDK or a credential. */
export interface LinearMoveIssuesDeps {
  readonly readInputs: (args: {
    destinationTeamKey: string;
    identifiers: readonly string[];
    home: string | undefined;
  }) => Promise<Result<LinearIssueMoveInputs, LinearLiveError>>;
  readonly recordDestination: (args: { document: LinearStatesDocument; home: string | undefined }) => void;
  readonly invokeIssue: (args: {
    form: LinearIssueForm;
    home: string | undefined;
    issueId: string;
  }) => Promise<IssueMoveInvocationResult>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * One write, a throw folded into a failed result. A throw can come after Linear took the write (the issue
 * ledger's own confirmation), so the diagnostic says to re-read the issue rather than
 * claiming it did not move.
 */
async function invokeOnce({
  deps,
  form,
  home,
  issueId,
}: {
  deps: LinearMoveIssuesDeps;
  form: LinearIssueForm;
  home: string | undefined;
  issueId: string;
}): Promise<IssueMoveInvocationResult> {
  try {
    return await deps.invokeIssue({ form, home, issueId });
  } catch (cause) {
    const message = errorMessage({ error: cause });
    return {
      diagnostics: [`the write threw (${message}); it may have landed, so re-read the issue before re-running`],
      exitCode: EXIT_ERROR,
      output: [],
    };
  }
}

/** Write each planned move in order, stopping at the first that does not exit 0 or throws. */
async function applyPlan({
  plan,
  deps,
  home,
}: {
  plan: IssueMovePlan;
  deps: LinearMoveIssuesDeps;
  home: string | undefined;
}): Promise<{ readonly applications: ReadonlyMap<string, IssueMoveApplication>; readonly failed: boolean }> {
  const applications = new Map<string, IssueMoveApplication>();
  let failed = false;
  for (const row of plan.rows) {
    if (row.kind !== "move") {
      continue;
    }
    if (failed) {
      applications.set(row.identifier, { status: "not attempted" });
      continue;
    }
    const result = await invokeOnce({ deps, form: row.form, home, issueId: row.issueId });
    if (result.exitCode === EXIT_OK) {
      applications.set(row.identifier, { output: result.output, status: "landed" });
      continue;
    }
    failed = true;
    applications.set(row.identifier, {
      diagnostics: result.diagnostics,
      exitCode: result.exitCode,
      output: result.output,
      status: "failed",
    });
  }
  return { applications, failed };
}

/** Print the report in the shape the caller asked for. */
function report({
  plan,
  applications,
  json,
  deps,
}: {
  plan: IssueMovePlan;
  applications: ReadonlyMap<string, IssueMoveApplication> | undefined;
  json: boolean;
  deps: LinearMoveIssuesDeps;
}): void {
  if (json) {
    deps.writeOut(moveIssuesJson({ applications, plan }));
    return;
  }
  for (const line of moveIssuesTextLines({ applications, plan })) {
    deps.writeOut(line);
  }
}

/**
 * Run `linear move-issues` against injected edges.
 *
 * @param rest argv after `linear move-issues`
 * @param deps the read, record, in-process write and output seams
 * @returns the process exit code
 */
export async function runLinearMoveIssues({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: LinearMoveIssuesDeps;
}): Promise<number> {
  const parsed = parseLinearMoveIssuesArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of linearVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(LINEAR_MOVE_ISSUES_USAGE);
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const inputs = await deps.readInputs({
    destinationTeamKey: options.destinationTeamKey,
    home: options.home,
    identifiers: options.identifiers,
  });
  if (inputs.isErr()) {
    deps.writeDiagnostic(inputs.error.message);
    return EXIT_ERROR;
  }
  const plan = planIssueMoves({
    children: inputs.value.children,
    destination: inputs.value.destination,
    identifiers: options.identifiers,
    issues: inputs.value.issues,
    sources: inputs.value.sources,
    viewerId: inputs.value.viewer.id,
  });
  const planned = planExitCode({ plan });
  if (!options.apply || planned !== EXIT_OK) {
    report({ applications: undefined, deps, json: options.json, plan });
    return planned;
  }
  deps.recordDestination({ document: inputs.value.destination, home: options.home });
  const applied = await applyPlan({ deps, home: options.home, plan });
  report({ applications: applied.applications, deps, json: options.json, plan });
  return applied.failed ? EXIT_ERROR : EXIT_OK;
}

/**
 * The argv one move hands `linear issue`, full-length because that verb slices its own offset. Pure.
 *
 * @param issueId the issue's UUID
 * @param home the named state home, carried through when one was given
 * @returns the argv
 */
export function moveIssueArgv({ issueId, home }: { issueId: string; home: string | undefined }): readonly string[] {
  return [
    "node",
    "slopweaver",
    "linear",
    "issue",
    "update",
    "--issue-id",
    issueId,
    "--fields-only",
    "--move-team",
    "--form",
    "-",
    ...(home === undefined ? [] : ["--home", home]),
  ];
}

/**
 * Production edges: the credential resolves from the named state home, and each write is the real verb's body.
 *
 * @returns the live reader, the catalog recorder, the in-process writer and the output sinks
 */
export function productionLinearMoveIssuesDeps(): LinearMoveIssuesDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    invokeIssue: async ({ form, home, issueId }) => {
      const output: string[] = [];
      const diagnostics: string[] = [];
      const exitCode = await runLinearIssue({
        argv: moveIssueArgv({ home, issueId }),
        deps: {
          ...productionLinearWriteDeps(),
          err: (line) => {
            diagnostics.push(line);
          },
          out: (line) => {
            output.push(line);
          },
          readForm: () => JSON.stringify(form),
        },
      });
      return { diagnostics, exitCode, output };
    },
    readInputs: async ({ destinationTeamKey, identifiers, home }) => {
      const token = linearToken(home === undefined ? {} : { home });
      if (token === undefined) {
        return err(
          LinearLiveErrors.readFailed({ message: "no Linear token configured; run `slopweaver connect linear`" }),
        );
      }
      return readLinearIssueMoveInputs({
        destinationTeamKey,
        identifiers,
        nowIso,
        request: linearStatesRequest({ token }),
      });
    },
    recordDestination: recordLinearStates,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver linear move-issues`. */
export const linearMoveIssuesCommand = defineCommand({
  run: (argv) => runLinearMoveIssues({ deps: productionLinearMoveIssuesDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
