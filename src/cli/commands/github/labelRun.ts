/** Effectful shell for the governed GitHub issue-label write. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubLabelApi, type IssueLabels, makeGithubLabelApi } from "../../../outbound/github/labels.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type GithubVerbError, GithubVerbErrors, githubVerbErrorLines } from "./errors.js";
import { type GithubLabelArgs, labelDoorRequest, parseGithubLabelArgs } from "./labelCore.js";
import { GITHUB_LABEL_USAGE } from "./prUsage.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubLabelDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubLabelApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Convert a neverthrow provider result into the command's small ordinary Result. */
async function readLabels({
  api,
  args,
}: {
  api: GithubLabelApi;
  args: GithubLabelArgs;
}): Promise<Result<IssueLabels, GithubVerbError>> {
  const read = await api.read({ number: args.number, owner: args.owner, repo: args.repo });
  return read.isErr()
    ? err(GithubVerbErrors.upstreamRefused({ operation: "read", reasons: [read.error.message] }))
    : ok(read.value);
}

/**
 * Refuse a label the repository does not define, rather than letting GitHub invent it.
 *
 * A truncated read is refused too: past the page ceiling "not in the list" stops meaning "not defined", and
 * the honest answer is that the check could not be completed.
 */
async function undefinedLabels({
  api,
  args,
}: {
  api: GithubLabelApi;
  args: GithubLabelArgs;
}): Promise<Result<readonly string[], GithubVerbError>> {
  const defined = await api.definedLabels({ owner: args.owner, repo: args.repo });
  if (defined.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "read labels", reasons: [defined.error.message] }));
  }
  if (defined.value.truncated) {
    return err(GithubVerbErrors.labelsUnverifiable({ owner: args.owner, repo: args.repo }));
  }
  const names = new Set(defined.value.names);
  return ok(args.add.filter((label) => !names.has(label)));
}

/** Send the addition once and confirm every requested label by read-back. */
async function addAndConfirm({
  api,
  args,
}: {
  api: GithubLabelApi;
  args: GithubLabelArgs;
}): Promise<Result<IssueLabels, GithubVerbError>> {
  const added = await api.add({ labels: args.add, number: args.number, owner: args.owner, repo: args.repo });
  if (added.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "add labels", reasons: [added.error.message] }));
  }
  const after = await readLabels({ api, args });
  if (after.isErr()) {
    return after;
  }
  const present = new Set(after.value.labels);
  const missing = args.add.filter((label) => !present.has(label));
  return missing.length === 0 ? after : err(GithubVerbErrors.labelsUnconfirmed({ missing, number: args.number }));
}

/** Print one result in the selected output mode. */
function report({
  deps,
  args,
  state,
  outcome,
}: {
  deps: GithubLabelDeps;
  args: GithubLabelArgs;
  state: IssueLabels;
  outcome: string;
}): void {
  deps.out(
    args.json
      ? JSON.stringify({ added: args.add, labels: state.labels, outcome, url: state.htmlUrl }, undefined, 2)
      : `${outcome} #${String(args.number)}  ${args.add.join(", ")}  ${state.htmlUrl}`,
  );
}

/** Read the live state, refuse an undefined label, and decide whether anything is left to write. */
async function preflight({
  api,
  args,
}: {
  api: GithubLabelApi;
  args: GithubLabelArgs;
}): Promise<Result<{ readonly current: IssueLabels; readonly missing: readonly string[] }, GithubVerbError>> {
  const unknown = await undefinedLabels({ api, args });
  if (unknown.isErr()) {
    return err(unknown.error);
  }
  if (unknown.value.length > 0) {
    return err(GithubVerbErrors.labelsUndefined({ labels: unknown.value, owner: args.owner, repo: args.repo }));
  }
  const current = await readLabels({ api, args });
  if (current.isErr()) {
    return err(current.error);
  }
  const present = new Set(current.value.labels);
  return ok({ current: current.value, missing: args.add.filter((label) => !present.has(label)) });
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ args, deps }: { args: GithubLabelArgs; deps: GithubLabelDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/**
 * Run the label addition.
 *
 * @param rest argv after `github label`
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubLabel({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubLabelDeps;
}): Promise<number> {
  const parsed = parseGithubLabelArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_LABEL_USAGE);
    return EXIT_USAGE;
  }
  const home = stateHomeOf({ args: parsed.value, deps });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const ready = await preflight({ api, args: parsed.value });
  if (ready.isErr()) {
    githubVerbErrorLines({ error: ready.error }).forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  if (ready.value.missing.length === 0) {
    report({ args: parsed.value, deps, outcome: "already labelled", state: ready.value.current });
    return EXIT_OK;
  }
  if (parsed.value.dryRun) {
    report({ args: parsed.value, deps, outcome: "would label", state: ready.value.current });
    return EXIT_OK;
  }
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => addAndConfirm({ api, args: parsed.value }),
    request: labelDoorRequest({ args: parsed.value, home }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github label", through })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    githubVerbErrorLines({ error: through.result.error }).forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  report({ args: parsed.value, deps, outcome: "labelled", state: through.result.value });
  return EXIT_OK;
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-client and output edges for the label command
 */
export function productionGithubLabelDeps(): GithubLabelDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubLabelApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github label`. */
export const githubLabelCommand = defineCommand({
  run: (argv) => runGithubLabel({ deps: productionGithubLabelDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
