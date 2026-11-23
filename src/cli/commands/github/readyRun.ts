/** Effectful shell for the governed GitHub draft-to-ready transition, and its `--undo` inverse. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { proofPathHatchOpen, proofPathRefusal } from "../../../admit/pushProofPathGate.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubReadyApi, makeGithubReadyApi, type ReadyPr } from "../../../outbound/github/ready.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { type GithubVerbError, GithubVerbErrors, githubVerbErrorLines } from "./errors.js";
import { GITHUB_READY_USAGE } from "./prUsage.js";
import { type GithubReadyArgs, parseGithubReadyArgs, readyDoorRequest } from "./readyCore.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubReadyDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  /** The environment, read only for the proof-path hatch. */
  readonly env: () => Readonly<Record<string, string | undefined>>;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubReadyApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Convert a neverthrow provider result into the command's small ordinary Result. */
async function readPr({
  api,
  args,
}: {
  api: GithubReadyApi;
  args: GithubReadyArgs;
}): Promise<Result<ReadyPr, GithubVerbError>> {
  const read = await api.read({ number: args.number, owner: args.owner, repo: args.repo });
  return read.isErr()
    ? err(GithubVerbErrors.upstreamRefused({ operation: "read", reasons: [read.error.message] }))
    : ok(read.value);
}

/**
 * Send the transition once and confirm it by read-back.
 *
 * The read-back is what makes either direction trustworthy: GitHub's own REST patch ignores `draft`
 * silently, so a mutation that reported success without a confirming read is exactly the class of lie this
 * command exists to refuse.
 */
async function markAndConfirm({
  api,
  args,
}: {
  api: GithubReadyApi;
  args: GithubReadyArgs;
}): Promise<Result<ReadyPr, GithubVerbError>> {
  const before = await readPr({ api, args });
  if (before.isErr()) {
    return before;
  }
  const marked = args.undo
    ? await api.markDraft({ nodeId: before.value.nodeId })
    : await api.markReady({ nodeId: before.value.nodeId });
  if (marked.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "mark", reasons: [marked.error.message] }));
  }
  const after = await readPr({ api, args });
  if (after.isErr()) {
    return after;
  }
  if (after.value.draft !== args.undo) {
    const stuck = args.undo ? "ready" : "draft";
    return err(GithubVerbErrors.mutationUnconfirmed({ number: args.number, state: stuck }));
  }
  return after;
}

/** Print one result in the selected output mode. */
function report({
  deps,
  args,
  pr,
  outcome,
}: {
  deps: GithubReadyDeps;
  args: GithubReadyArgs;
  pr: ReadyPr;
  outcome: string;
}): void {
  deps.out(
    args.json
      ? JSON.stringify({ outcome, pullRequest: pr }, undefined, 2)
      : `${outcome} #${String(pr.number)}  ${pr.url}`,
  );
}

/**
 * Name the outcome for one direction and stage.
 *
 * One table rather than a ternary at each of the four call sites, so the two directions read as the same
 * command run backwards instead of as branches that happen to look alike.
 *
 * @param undo whether the transition runs backwards, towards draft
 * @param stage which of the three moments is being reported
 * @returns the line's leading phrase
 */
function outcomeLabel({ undo, stage }: { undo: boolean; stage: "already" | "would" | "did" }): string {
  const labels = {
    already: { forward: "already ready", undo: "already draft" },
    did: { forward: "marked ready", undo: "returned to draft" },
    would: { forward: "would mark ready", undo: "would return to draft" },
  } as const;
  return undo ? labels[stage].undo : labels[stage].forward;
}

/**
 * Whether undrafting is refused because the pull request introduces proof output, printing why.
 *
 * Runs before a dry run reports, so a dry run discloses the same refusal; fails closed on a read it could
 * not complete, because a policy over EVERY introduced path cannot pass on part of the list.
 *
 * @returns true when the transition must not happen (the reason is already written)
 */
async function proofPathRefused({
  api,
  args,
  deps,
}: {
  api: GithubReadyApi;
  args: GithubReadyArgs;
  deps: GithubReadyDeps;
}): Promise<boolean> {
  const files = await api.introducedFiles({ number: args.number, owner: args.owner, repo: args.repo });
  if (files.isErr()) {
    deps.writeDiagnostic(
      `could not list the files pull request #${String(args.number)} introduces, so it was not checked for proof output: ${files.error.message}`,
    );
    return true;
  }
  const refusal = proofPathRefusal({
    hatchOpen: proofPathHatchOpen({ env: deps.env() }),
    paths: files.value,
    subject: `pull request #${String(args.number)}`,
  });
  if (refusal === undefined) {
    return false;
  }
  for (const line of refusal) {
    deps.writeDiagnostic(line);
  }
  return true;
}

/**
 * Everything after the pre-write read: short-circuit, dry-run, or the door round-trip.
 *
 * Split out of the command so the shell stays a parse-resolve-read sequence and this holds the one decision
 * that has branches.
 *
 * @param current the pull request as the pre-write read found it
 * @returns the process exit code
 */
async function transition({
  api,
  args,
  current,
  deps,
  home,
}: {
  api: GithubReadyApi;
  args: GithubReadyArgs;
  current: ReadyPr;
  deps: GithubReadyDeps;
  home: string;
}): Promise<number> {
  // Before the already-ready return: a ready pull request carrying proof output is named, not waved through.
  if (!args.undo) {
    const refused = await proofPathRefused({ api, args, deps });
    if (refused) {
      return EXIT_ERROR;
    }
  }
  if (current.draft === args.undo) {
    report({ args, deps, outcome: outcomeLabel({ stage: "already", undo: args.undo }), pr: current });
    return EXIT_OK;
  }
  if (args.dryRun) {
    report({ args, deps, outcome: outcomeLabel({ stage: "would", undo: args.undo }), pr: current });
    return EXIT_OK;
  }
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => markAndConfirm({ api, args }),
    request: readyDoorRequest({ args, home }),
  });
  if (!through.performed) {
    const command = args.undo ? "slopweaver github ready --undo" : "slopweaver github ready";
    for (const line of notPerformedLines({ command, through })) {
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
  report({ args, deps, outcome: outcomeLabel({ stage: "did", undo: args.undo }), pr: through.result.value });
  return EXIT_OK;
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ args, deps }: { args: GithubReadyArgs; deps: GithubReadyDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/**
 * Run the ready transition.
 *
 * @param rest argv after `github ready`
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubReady({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubReadyDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "github", rest, verb: "ready" });
  if (gated !== undefined) {
    return gated;
  }
  const parsed = parseGithubReadyArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_READY_USAGE);
    return EXIT_USAGE;
  }
  const home = stateHomeOf({ args: parsed.value, deps });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const current = await readPr({ api, args: parsed.value });
  if (current.isErr()) {
    githubVerbErrorLines({ error: current.error }).forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  return transition({ api, args: parsed.value, current: current.value, deps, home });
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-client and output edges for the ready command
 */
export function productionGithubReadyDeps(): GithubReadyDeps {
  return {
    doorLedger: doorLedgerPort(),
    env: () => process.env,
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubReadyApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github ready`. */
export const githubReadyCommand = defineCommand({
  run: (argv) => runGithubReady({ deps: productionGithubReadyDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
