/**
 * `slopweaver github hold` and `slopweaver github release` — the effectful shell. Every decision lives in
 * `./holdCore.js` and `../../../outbound/github/mergeHold.js`; this file resolves the home, reads the clock
 * and this session's own id, replaces the hold document and publishes to the supervisor stream.
 *
 * The injectable edges, the journal append and the shared LOOK at the hold document live in `./holdDeps.ts`,
 * whose header says why nothing polls a hold and why every transition is journalled.
 *
 * ## `--status` asks whether the HOLDER is still alive
 *
 * A hold belongs to a session, and the measured failure that retired the hand-run lane was
 * head-of-line blocking behind holders that had gone away (`skills/github/reference/merge-hold.md`). The
 * liveness verdict comes from the same live-session registry every other surface asks
 * (`measurement/sessions.ts`), and it is REPORTED, never acted on: a dead holder's hold keeps refusing
 * exactly as it did, because expiring it automatically would make holding safer to reach for, and the hold
 * is the exception rather than the lane.
 */
import { holdLedgerRenderedLines } from "../../../outbound/github/holdLedger.js";
import {
  holdAgeMinutes,
  holdEvent,
  holdFor,
  holdReport,
  holdStatusJson,
  holdStatusLines,
  type MergeHold,
} from "../../../outbound/github/mergeHold.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { githubVerbErrorLines } from "./errors.js";
import {
  type GithubHoldArgs,
  type GithubReleaseArgs,
  holderNamedBy,
  parseGithubHoldArgs,
  parseGithubReleaseArgs,
} from "./holdCore.js";
import { journal, type MergeHoldDeps, noteStaleHolds, productionMergeHoldDeps } from "./holdDeps.js";
import { GITHUB_HOLD_USAGE, GITHUB_RELEASE_USAGE } from "./holdUsage.js";

/** Where these verbs' own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** `--status`: report every standing hold, having first warned about any that has stood too long. */
function reportStatus({
  args,
  deps,
  home,
}: {
  args: Extract<GithubHoldArgs, { mode: "status" }>;
  deps: MergeHoldDeps;
  home: string;
}): number {
  const holds = noteStaleHolds({ deps, holds: deps.readHolds({ home }), home });
  const nowIso = deps.nowIso();
  const reports = holds.map((hold) =>
    holdReport({ hold, holderLive: deps.holderLive({ holder: hold.holder }), nowIso }),
  );
  if (args.asJson) {
    deps.out({ line: holdStatusJson({ reports }) });
    return EXIT_OK;
  }
  for (const line of holdStatusLines({ reports })) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/** `--history`: report the journalled transitions, so a released hold's duration survives its release. */
function reportHistory({
  args,
  deps,
  home,
}: {
  args: Extract<GithubHoldArgs, { mode: "history" }>;
  deps: MergeHoldDeps;
  home: string;
}): number {
  const rows = deps.readLedgerRows({ home, limit: args.limit });
  if (args.asJson) {
    deps.out({ line: JSON.stringify({ rows }) });
    return EXIT_OK;
  }
  for (const line of holdLedgerRenderedLines({ rows })) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/**
 * Report a hold that already stands over the repository a placement names.
 *
 * Split from {@link placeHold} so the two shapes stay visibly different: re-holding the SAME pull request is
 * a no-op that succeeds, and holding a DIFFERENT one is a refusal — folding them into one branch is how a
 * caller ends up believing its own hold is standing when somebody else's is.
 */
function reportStandingHold({
  args,
  deps,
  standing,
}: {
  args: Extract<GithubHoldArgs, { mode: "place" }>;
  deps: MergeHoldDeps;
  standing: MergeHold;
}): number {
  if (standing.pr === args.pr) {
    deps.out({
      line:
        `${standing.repo}#${String(standing.pr)} is already held — placed by ${standing.holder} at ` +
        `${standing.atIso}: ${standing.why}`,
    });
    return EXIT_OK;
  }
  deps.out({
    line:
      `refused: ${standing.repo}#${String(standing.pr)} already holds this repository's merge queue — ` +
      `placed by ${standing.holder} at ${standing.atIso}: ${standing.why}`,
  });
  deps.out({
    line: `release it first with \`slopweaver github release --pr ${String(standing.pr)} --repo ${standing.repo}\`.`,
  });
  return EXIT_ERROR;
}

/** Place a hold, or report the one that already owns this repository's queue. */
function placeHold({
  args,
  deps,
  home,
}: {
  args: Extract<GithubHoldArgs, { mode: "place" }>;
  deps: MergeHoldDeps;
  home: string;
}): number {
  const holds = noteStaleHolds({ deps, holds: deps.readHolds({ home }), home });
  const standing = holdFor({ holds, repo: args.repo });
  if (standing !== undefined) {
    return reportStandingHold({ args, deps, standing });
  }
  const nowIso = deps.nowIso();
  const hold: MergeHold = {
    atIso: nowIso,
    holder: holderNamedBy({ sessionId: deps.sessionId() }),
    pr: args.pr,
    repo: args.repo,
    staleMinutes: args.staleMinutes,
    staleWarnedAtIso: undefined,
    why: args.why,
  };
  const written = deps.writeHolds({ holds: [...holds, hold], home });
  if (written.isErr()) {
    deps.out({ line: `refused: ${written.error.join("; ")}` });
    return EXIT_ERROR;
  }
  journal({ deps, hold, home, kind: "held", nowIso });
  deps.publish({
    event: holdEvent({
      hold,
      kind: "held",
      nowIso,
      why:
        `${hold.repo}#${String(hold.pr)} now owns the merge queue, held by ${hold.holder}: ${hold.why}. ` +
        "Every other pull request in that repository is refused at `slopweaver github merge` and at " +
        "`slopweaver github enqueue`.",
    }),
    home,
  });
  if (args.asJson) {
    deps.out({ line: JSON.stringify({ held: hold }) });
    return EXIT_OK;
  }
  deps.out({
    line:
      `held: ${hold.repo}#${String(hold.pr)} owns the merge queue — every other pull request in that ` +
      "repository is refused by `slopweaver github merge` and `slopweaver github enqueue` until it is released.",
  });
  deps.out({
    line:
      "the hold refuses THOSE verbs only: `gh pr merge`, GitHub's own 'Merge when ready' button and an " +
      "administrator override still bypass it entirely.",
  });
  return EXIT_OK;
}

/**
 * Clear the hold on one repository, or say exactly why it was not cleared.
 *
 * Exported because `github merge --admin` calls it directly the moment it lands the held pull request: the
 * verb that finished the work is the one best placed to release it, and a hold that outlives its own merge
 * is exactly the state {@link noteStaleHolds} would otherwise spend half an hour discovering.
 *
 * @param deps the injectable edges
 * @param home the state home the document lives in
 * @param pr the pull request whose hold this clears
 * @param repo the repository the hold governs
 * @param sha the commit it landed as, when one is known — recorded on the supervisor stream
 * @returns the process exit code
 */
export function releaseHold({
  deps,
  home,
  pr,
  repo,
  sha,
}: {
  deps: MergeHoldDeps;
  home: string;
  pr: number;
  repo: string;
  sha: string | undefined;
}): number {
  const holds = deps.readHolds({ home });
  const standing = holdFor({ holds, repo });
  if (standing === undefined) {
    deps.out({ line: `no merge hold stands on ${repo}.` });
    return EXIT_OK;
  }
  if (standing.pr !== pr) {
    deps.out({
      line:
        `refused: ${repo}'s merge queue is held for #${String(standing.pr)}, not the requested ` +
        `#${String(pr)} — releasing it would clear a hold that is still doing its job.`,
    });
    return EXIT_ERROR;
  }
  const written = deps.writeHolds({ holds: holds.filter((hold) => hold !== standing), home });
  if (written.isErr()) {
    deps.out({ line: `refused: ${written.error.join("; ")}` });
    return EXIT_ERROR;
  }
  const nowIso = deps.nowIso();
  const landed = sha === undefined ? "no landed commit was recorded" : `landed as ${sha}`;
  journal({ deps, hold: standing, home, kind: "released", nowIso, sha });
  deps.publish({
    event: holdEvent({
      hold: standing,
      kind: "released",
      nowIso,
      why:
        `${repo}#${String(pr)} released the merge queue after ${String(holdAgeMinutes({ hold: standing, nowIso }))}m — ` +
        `${landed}. Every pull request in that repository may merge through the door again.`,
    }),
    home,
  });
  deps.out({ line: `released: ${repo}#${String(pr)} no longer holds the merge queue — ${landed}.` });
  return EXIT_OK;
}

/**
 * Clear the hold ONLY when the pull request named is the one holding this repository's queue.
 *
 * The narrow shape `github merge --admin` calls the moment its own merge lands: a merge that succeeded
 * because no hold stood, or because somebody acknowledged their way past one, must not clear a hold that is
 * still doing its job for another pull request. The door releasing its own hold is half of what this whole
 * mechanism replaces — the second round of hand-typed messages carrying the landed SHA.
 *
 * @param deps the injectable edges
 * @param home the state home the document lives in
 * @param pr the pull request that just landed
 * @param repo the repository it landed in
 * @param sha the commit it landed as, recorded on the supervisor stream
 */
export function releaseHeldPullRequest({
  deps,
  home,
  pr,
  repo,
  sha,
}: {
  deps: MergeHoldDeps;
  home: string;
  pr: number;
  repo: string;
  sha: string;
}): void {
  if (holdFor({ holds: deps.readHolds({ home }), repo })?.pr !== pr) {
    return;
  }
  releaseHold({ deps, home, pr, repo, sha });
}

/**
 * The whole `github hold` verb, with its edges injected.
 *
 * @param argv the FULL process argv; this verb's own arguments start at {@link VERB_ARG_OFFSET}
 * @param deps the injectable edges — hold document, clock, session id, stream publisher and output sink
 * @returns the process exit code
 */
export function runGithubHold({
  argv,
  deps = productionMergeHoldDeps(),
}: {
  argv: readonly string[];
  deps?: MergeHoldDeps;
}): number {
  const parsed = parseGithubHoldArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of githubVerbErrorLines({ error: parsed.error })) {
      deps.out({ line });
    }
    deps.out({ line: GITHUB_HOLD_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (args.mode === "status") {
    return reportStatus({ args, deps, home });
  }
  if (args.mode === "history") {
    return reportHistory({ args, deps, home });
  }
  return placeHold({ args, deps, home });
}

/**
 * The whole `github release` verb, with its edges injected.
 *
 * @param argv the FULL process argv; this verb's own arguments start at {@link VERB_ARG_OFFSET}
 * @param deps the injectable edges — hold document, clock, stream publisher and output sink
 * @returns the process exit code
 */
export function runGithubRelease({
  argv,
  deps = productionMergeHoldDeps(),
}: {
  argv: readonly string[];
  deps?: MergeHoldDeps;
}): number {
  const parsed = parseGithubReleaseArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of parsed.error) {
      deps.out({ line });
    }
    deps.out({ line: GITHUB_RELEASE_USAGE });
    return EXIT_USAGE;
  }
  const args: GithubReleaseArgs = parsed.value;
  return releaseHold({ deps, home: resolveHome({ named: args.home }), pr: args.pr, repo: args.repo, sha: args.sha });
}

/**
 * The registered `hold` command. Only `run` — every other field lives in
 * `../../manifests/githubPullRequestActions.js`.
 */
export const githubHoldCommand = defineCommand({ run: (argv: readonly string[]) => runGithubHold({ argv }) });

/** The registered `release` command. Only `run` — every other field lives in `../../manifests/github.js`. */
export const githubReleaseCommand = defineCommand({ run: (argv: readonly string[]) => runGithubRelease({ argv }) });
