/** Effectful shell for the governed remote-branch delete. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubRefsApi, makeGithubRefsApi } from "../../../outbound/github/refs.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  type BranchDeletePlan,
  branchDeleteDoorRequest,
  branchDeleteDryRunLine,
  type GithubBranchArgs,
  parseGithubBranchArgs,
  planBranchDelete,
} from "./branchDeleteCore.js";
import { confirmAcceptedWrite, type Deleted, settleErroredWrite } from "./branchDeleteSettle.js";
import { githubVerbErrorLines } from "./errors.js";
import { type GithubRefsError, GithubRefsErrors } from "./refsErrors.js";
import { GITHUB_BRANCH_USAGE } from "./refsUsage.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubBranchDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubRefsApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Read everything the decision needs from the live remote and decide.
 *
 * @param api the ref surface
 * @param args the parsed request
 * @returns the plan, or the provider failure
 */
async function readAndPlan({
  api,
  args,
}: {
  api: GithubRefsApi;
  args: GithubBranchArgs;
}): Promise<Result<BranchDeletePlan>> {
  const address = { owner: args.owner, repo: args.repo };
  const [tip, defaultBranch, openPrs] = await Promise.all([
    api.branchTip({ ...address, branch: args.branch }),
    api.defaultBranch(address),
    api.openPrsOnBranch({ ...address, branch: args.branch }),
  ]);
  if (tip.isErr()) {
    return err([tip.error.message]);
  }
  if (defaultBranch.isErr()) {
    return err([defaultBranch.error.message]);
  }
  if (openPrs.isErr()) {
    return err([openPrs.error.message]);
  }
  let keepTagCommit: string | undefined;
  if (args.keepAsTag !== undefined) {
    const tagged = await api.tagCommit({ ...address, tag: args.keepAsTag });
    if (tagged.isErr()) {
      return err([tagged.error.message]);
    }
    keepTagCommit = tagged.value;
  }
  return ok(
    planBranchDelete({
      branch: args.branch,
      defaultBranch: defaultBranch.value,
      expectTip: args.expectTip,
      keepAsTag: args.keepAsTag,
      keepTagCommit,
      openPrs: openPrs.value,
      tip: tip.value,
    }),
  );
}

/**
 * Re-decide from a fresh read and refuse anything the printed plan no longer describes: a branch that moved,
 * gained an open pull request or had its keep-tag change since the preflight.
 */
async function recheckPlan({
  api,
  args,
  plan,
}: {
  api: GithubRefsApi;
  args: GithubBranchArgs;
  plan: Extract<BranchDeletePlan, { kind: "delete" }>;
}): Promise<Result<void, GithubRefsError>> {
  const fresh = await readAndPlan({ api, args });
  if (fresh.isErr()) {
    return err(GithubRefsErrors.providerFailed({ cause: fresh.error.join("; "), kept: undefined, step: "re-read" }));
  }
  if (fresh.value.kind === "refuse") {
    return err(GithubRefsErrors.stateChanged({ kept: undefined, what: fresh.value.reason }));
  }
  if (fresh.value.tip !== plan.tip) {
    const what = `${args.branch} moved from ${plan.tip} to ${fresh.value.tip}`;
    return err(GithubRefsErrors.stateChanged({ kept: undefined, what }));
  }
  if (fresh.value.tagFirst !== plan.tagFirst) {
    const what = `tag ${String(args.keepAsTag)} ${plan.tagFirst ? "appeared" : "disappeared"} since the plan was printed`;
    return err(GithubRefsErrors.stateChanged({ kept: undefined, what }));
  }
  return ok(undefined);
}

/**
 * Re-decide from a fresh read, then tag and delete in ONE atomic compare-and-swap, and confirm by read-back —
 * the whole transition as one door-recorded action. The write names the tip it expects and the keep-tag's state
 * — absent, or held at the tip — so a push or a tag removal landing after the re-read makes GitHub reject the
 * whole update rather than delete a commit nobody saw or leave it with no recovery point, and no tag is left
 * behind a refusal.
 */
async function tagDeleteAndConfirm({
  api,
  args,
  plan,
}: {
  api: GithubRefsApi;
  args: GithubBranchArgs;
  plan: Extract<BranchDeletePlan, { kind: "delete" }>;
}): Promise<Result<Deleted, GithubRefsError>> {
  const rechecked = await recheckPlan({ api, args, plan });
  if (rechecked.isErr()) {
    return err(rechecked.error);
  }
  // A keep-tag is IN the write either way: made there if absent, held there if present — never left out of it.
  const createTag = plan.tagFirst ? args.keepAsTag : undefined;
  const holdTag = plan.tagFirst ? undefined : args.keepAsTag;
  const { owner, repo, branch } = args;
  const updated = await api.deleteBranchAtTip({ branch, createTag, holdTag, owner, repo, tip: plan.tip });
  if (updated.isErr()) {
    return settleErroredWrite({ api, args, cause: updated.error.message, createTag, tip: plan.tip });
  }
  return confirmAcceptedWrite({ api, args, createTag, tip: plan.tip });
}

/** Print a settled delete in the selected mode. */
function reportDeleted({
  args,
  deleted,
  deps,
}: {
  args: GithubBranchArgs;
  deleted: Deleted;
  deps: GithubBranchDeps;
}): void {
  const { tip, keptAs, byThisRun } = deleted;
  if (args.json) {
    const outcome = byThisRun ? "deleted" : "gone";
    deps.out(JSON.stringify({ branch: args.branch, keptAs, outcome, tip }, undefined, 2));
    return;
  }
  const kept = keptAs === undefined ? "" : `, kept as tag ${keptAs}`;
  const verb = byThisRun ? "deleted" : "gone:";
  const unclear = byThisRun ? "" : "; this run's write answered an error, so this run or another writer removed it";
  deps.out(`${verb} ${args.owner}/${args.repo} ${args.branch} at ${tip}${kept}${unclear}`);
}

/**
 * Parse the request and resolve its credential into a ref client, or print why not.
 *
 * @returns the parsed request, its home and client, or the exit code already reported
 */
function openBranchRequest({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubBranchDeps;
}): Result<{ args: GithubBranchArgs; home: string; api: GithubRefsApi }, number> {
  const parsed = parseGithubBranchArgs({ argv: rest });
  if (parsed.isErr()) {
    for (const problem of githubVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_BRANCH_USAGE);
    return err(EXIT_USAGE);
  }
  const args = parsed.value;
  const { home = deps.home() } = args;
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return err(EXIT_ERROR);
  }
  return ok({ api: deps.makeApi({ home, token }), args, home });
}

/**
 * Run the delete.
 *
 * @param rest argv after `github branch`
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubBranch({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubBranchDeps;
}): Promise<number> {
  const opened = openBranchRequest({ deps, rest });
  if (opened.isErr()) {
    return opened.error;
  }
  const { api, args, home } = opened.value;
  const plan = await readAndPlan({ api, args });
  if (plan.isErr()) {
    for (const problem of plan.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const deletePlan = plan.value;
  if (deletePlan.kind === "refuse") {
    deps.writeDiagnostic(`refused: ${deletePlan.reason}`);
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    const line = args.json
      ? JSON.stringify({ outcome: "would delete", plan: deletePlan }, undefined, 2)
      : branchDeleteDryRunLine({ args, plan: deletePlan });
    deps.out(line);
    return EXIT_OK;
  }
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => tagDeleteAndConfirm({ api, args, plan: deletePlan }),
    request: branchDeleteDoorRequest({ args, home }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github branch delete", through })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    deps.writeDiagnostic(through.result.error.message);
    return EXIT_ERROR;
  }
  reportDeleted({ args, deleted: through.result.value, deps });
  return EXIT_OK;
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, ref-client and output edges for the delete command
 */
export function productionGithubBranchDeps(): GithubBranchDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubRefsApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github branch`. */
export const githubBranchCommand = defineCommand({
  run: (argv) => runGithubBranch({ deps: productionGithubBranchDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
