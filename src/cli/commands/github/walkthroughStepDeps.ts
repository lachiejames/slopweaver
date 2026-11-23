/**
 * The production edges `./walkthroughStep.ts` reads, resolves and records through.
 *
 * Its own file so the step itself stays a sequence over plain seams a unit test hands in, and so every
 * credential read and child verb it reaches sits in one place that decides nothing.
 */

import { autonomyLedgerPort } from "../../../autonomy/port.js";
import { githubToken } from "../../../config.js";
import { currentSessionId } from "../../../handover/runOwner.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { viewerLogin } from "../../../live/github/coderabbitYield.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { makeGithubReviewStateApi } from "../../../live/github/reviewState.js";
import {
  appendWalkthroughLedger,
  readWalkthroughLedger,
  walkthroughMemory,
} from "../../../outbound/github/walkthroughLedger.js";
import { type GithubThreadDeps, productionGithubThreadDeps, runGithubThread } from "./threadRun.js";
import type { WalkthroughRead, WalkthroughStepDeps } from "./walkthroughStep.js";

/** The fewest check contexts and changed paths GitHub accepts: this read wants the author and threads only. */
const SMALLEST_PAGE = 1;

/**
 * Read the pull request's author, head, the token's own login and every thread, bodies left unasked for.
 *
 * @param home the state home whose credential the read uses
 * @param owner the repository's owner
 * @param repo the repository's name
 * @param number the pull request
 * @returns the read, or why it failed
 */
async function readWalkthroughs({
  home,
  owner,
  repo,
  number,
}: {
  home: string;
  owner: string;
  repo: string;
  number: number;
}): Promise<Result<WalkthroughRead>> {
  const token = githubToken({ home });
  if (token === undefined) {
    return err(["no GitHub token configured"]);
  }
  const graphql = githubReadGraphql({ token });
  const viewer = await viewerLogin({ graphql });
  if (viewer.isErr()) {
    return err([viewer.error.message]);
  }
  const state = await makeGithubReviewStateApi({ graphql }).pr({
    checkLimit: SMALLEST_PAGE,
    fileLimit: SMALLEST_PAGE,
    number,
    owner,
    repo,
    // One pull request's bodies, so a refusal on an unanswered reply can print the reply it refuses on.
    withBodies: true,
  });
  if (state.isErr()) {
    return err([state.error.message]);
  }
  return ok({
    authorLogin: state.value.authorLogin,
    headOid: state.value.headOid,
    threads: state.value.threads,
    truncated: state.value.threadsTruncated,
    viewerLogin: viewer.value,
  });
}

/**
 * What identifies this session on the ledger row, or the step's own address when no session is known.
 *
 * @returns the session id, or the step that resolved the threads
 */
function sessionRefNow(): string {
  const session = currentSessionId({ env: process.env });
  if (session === undefined) {
    return "github walkthrough clearance";
  }
  return session;
}

/**
 * Production edges. The child `github thread resolve`/`reopen` writes its own prose to the DIAGNOSTIC channel,
 * so a landing verb's `--json` document stays one parseable object.
 *
 * @returns the read, resolve, reopen, register, ledger, hatch, session and clock seams
 */
export function productionWalkthroughStepDeps(): WalkthroughStepDeps {
  const threadDeps: GithubThreadDeps = productionGithubThreadDeps();
  const autonomy = autonomyLedgerPort();
  const warnOut: GithubThreadDeps["out"] = (line) => {
    logger.warn({ msg: line });
  };
  // `runGithubThread` slices four leading argv words off, so the sub-verb is the FIFTH token.
  const threadVerb = ({ subVerb, rest }: { subVerb: string; rest: readonly string[] }): Promise<number> =>
    runGithubThread({
      argv: ["node", "slopweaver", "github", "thread", subVerb, ...rest],
      deps: { ...threadDeps, out: warnOut },
    });
  return {
    now: () => new Date(),
    recordAutonomy: async ({ home, row }) => {
      const written = await autonomy.appendRecord({ home, record: row });
      return written.isErr() ? written.error.message : undefined;
    },
    reopenThread: ({ rest }) => threadVerb({ rest, subVerb: "reopen" }),
    resolveThread: ({ rest }) => threadVerb({ rest, subVerb: "resolve" }),
    rememberThreads: ({ home, repo, number, acts }) => {
      const atIso = new Date().toISOString();
      const rows = acts.map((act) => ({ ...act, atIso, number, repo }));
      const written = appendWalkthroughLedger({ home, nowIso: atIso, rows });
      return written.isErr() ? written.error.message : undefined;
    },
    sessionRef: sessionRefNow,
    threadMemory: ({ home, repo, number }) => {
      const rows = readWalkthroughLedger({ home });
      return rows.isErr() ? err([rows.error.message]) : ok(walkthroughMemory({ number, repo, rows: rows.value }));
    },
    unseenThreadsAllowed: () => process.env["SLOPWEAVER_ALLOW_UNSEEN_REVIEW_THREADS"] === "1",
    walkthroughs: readWalkthroughs,
  };
}
