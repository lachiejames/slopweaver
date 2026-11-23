/** Effectful shell for the governed GitHub pull-request close. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type ClosePr, type GithubCloseApi, makeGithubCloseApi } from "../../../outbound/github/close.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import {
  closeCommentWindowStartIso,
  closeDoorRequest,
  closeHeadRefusal,
  closeIdentityRefusal,
  closeStateRefusal,
  type GithubCloseArgs,
  hasCommentSince,
  parseGithubCloseArgs,
} from "./closeCore.js";
import { type GithubVerbError, GithubVerbErrors, githubVerbErrorLines } from "./errors.js";
import { GITHUB_CLOSE_USAGE } from "./prUsage.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubCloseDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubCloseApi;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Convert a neverthrow provider result into the command's small ordinary Result. */
async function readPr({
  api,
  args,
}: {
  api: GithubCloseApi;
  args: GithubCloseArgs;
}): Promise<Result<ClosePr, GithubVerbError>> {
  const read = await api.read({ number: args.number, owner: args.owner, repo: args.repo });
  return read.isErr()
    ? err(GithubVerbErrors.upstreamRefused({ operation: "read", reasons: [read.error.message] }))
    : ok(read.value);
}

/**
 * Post the closing comment (when `--why` was given), close once, and confirm by a fresh read — the whole
 * transition as one door-recorded action, matching `readyRun.ts`'s `markAndConfirm`.
 */
async function commentCloseAndConfirm({
  api,
  args,
}: {
  api: GithubCloseApi;
  args: GithubCloseArgs;
}): Promise<Result<ClosePr, GithubVerbError>> {
  if (args.why !== undefined) {
    const commented = await api.comment({ body: args.why, number: args.number, owner: args.owner, repo: args.repo });
    if (commented.isErr()) {
      return err(GithubVerbErrors.upstreamRefused({ operation: "comment", reasons: [commented.error.message] }));
    }
  }
  const closed = await api.close({ number: args.number, owner: args.owner, repo: args.repo });
  if (closed.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "close", reasons: [closed.error.message] }));
  }
  const after = await readPr({ api, args });
  if (after.isErr()) {
    return after;
  }
  return after.value.state.toLowerCase() === "closed"
    ? after
    : err(GithubVerbErrors.mutationUnconfirmed({ number: args.number, state: after.value.state }));
}

/** Print one result in the selected output mode. */
function report({
  deps,
  args,
  pr,
  outcome,
}: {
  deps: GithubCloseDeps;
  args: GithubCloseArgs;
  pr: ClosePr;
  outcome: string;
}): void {
  deps.out(
    args.json
      ? JSON.stringify({ outcome, pullRequest: pr }, undefined, 2)
      : `${outcome} #${String(pr.number)}  ${pr.url}`,
  );
}

/**
 * Whether the comment gate is satisfied: a `--why` supplies its own closing comment, and otherwise the pull
 * request must already carry one (any author) from within the last hour.
 *
 * @param api the read/mutation surface
 * @param args the parsed close request
 * @param nowIso the current instant, ISO-8601
 * @returns the refusal reason, or undefined when the gate is satisfied
 */
async function commentGateRefusal({
  api,
  args,
  nowIso,
}: {
  api: GithubCloseApi;
  args: GithubCloseArgs;
  nowIso: string;
}): Promise<Result<string | undefined, GithubVerbError>> {
  if (args.why !== undefined) {
    return ok(undefined);
  }
  const cutoffIso = closeCommentWindowStartIso({ nowIso });
  const recent = await api.recentComments({
    number: args.number,
    owner: args.owner,
    repo: args.repo,
    sinceIso: cutoffIso,
  });
  if (recent.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "read comments", reasons: [recent.error.message] }));
  }
  if (hasCommentSince({ comments: recent.value, cutoffIso })) {
    return ok(undefined);
  }
  return ok(
    `#${String(args.number)} has no comment from the last hour and no --why was given — a silent close is ` +
      'refused; pass --why "…" or comment on the pull request first',
  );
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ args, deps }: { args: GithubCloseArgs; deps: GithubCloseDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/** What resolving credentials, reading the live pull request and every preflight refusal produced. */
interface CloseTarget {
  readonly api: GithubCloseApi;
  readonly home: string;
  readonly pr: ClosePr;
}

/**
 * Resolve a token, read the live pull request, and apply the state and comment-gate refusals — everything
 * that must happen before the door decides, whether or not this invocation is a dry run.
 *
 * @param args the parsed close request
 * @param deps credential, client and clock seams
 * @returns the live client, home and pull request to close, or every refusal reason
 */
async function resolveCloseTarget({
  args,
  deps,
}: {
  args: GithubCloseArgs;
  deps: GithubCloseDeps;
}): Promise<Result<CloseTarget, GithubVerbError>> {
  const home = stateHomeOf({ args, deps });
  const token = deps.token({ home });
  if (token === undefined) {
    return err(GithubVerbErrors.githubTokenMissing());
  }
  const api = deps.makeApi({ home, token });
  const current = await readPr({ api, args });
  if (current.isErr()) {
    return err(current.error);
  }
  const identityRefusal = closeIdentityRefusal({ args, number: current.value.number, url: current.value.url });
  if (identityRefusal !== undefined) {
    return err(GithubVerbErrors.closeRefused({ reason: identityRefusal.reason }));
  }
  const stateRefusal = closeStateRefusal({
    mergedAtIso: current.value.mergedAtIso,
    number: current.value.number,
    state: current.value.state,
  });
  if (stateRefusal !== undefined) {
    return err(GithubVerbErrors.closeRefused({ reason: stateRefusal.reason }));
  }
  const headRefusal = closeHeadRefusal({
    expectHead: args.expectHead,
    headSha: current.value.headSha,
    number: current.value.number,
  });
  if (headRefusal !== undefined) {
    return err(GithubVerbErrors.closeRefused({ reason: headRefusal.reason }));
  }
  const gate = await commentGateRefusal({ api, args, nowIso: deps.nowIso() });
  if (gate.isErr()) {
    return err(gate.error);
  }
  return gate.value === undefined
    ? ok({ api, home, pr: current.value })
    : err(GithubVerbErrors.closeRefused({ reason: gate.value }));
}

/**
 * Run the close.
 *
 * @param rest argv after `github close`
 * @param deps credential, client, clock and output seams
 * @returns the process exit code
 */
export async function runGithubClose({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubCloseDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "github", rest, verb: "close" });
  if (gated !== undefined) {
    return gated;
  }
  const parsed = parseGithubCloseArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_CLOSE_USAGE);
    return EXIT_USAGE;
  }
  const target = await resolveCloseTarget({ args: parsed.value, deps });
  if (target.isErr()) {
    githubVerbErrorLines({ error: target.error }).forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  const { api, home, pr } = target.value;
  if (parsed.value.dryRun) {
    report({ args: parsed.value, deps, outcome: "would close", pr });
    return EXIT_OK;
  }
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => commentCloseAndConfirm({ api, args: parsed.value }),
    request: closeDoorRequest({ args: parsed.value, home }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github close", through })) {
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
  report({ args: parsed.value, deps, outcome: "closed", pr: through.result.value });
  return EXIT_OK;
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-client, clock and output edges for the close command
 */
export function productionGithubCloseDeps(): GithubCloseDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubCloseApi({ privacy: githubWritePrivacy({ home }), token }),
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github close`. */
export const githubCloseCommand = defineCommand({
  run: (argv) => runGithubClose({ deps: productionGithubCloseDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
