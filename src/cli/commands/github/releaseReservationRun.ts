/**
 * Effectful shell for `slopweaver github pr release-reservation` — the operator's door onto a held create
 * reservation, and the reason recovering one is never `rm` on a trust ledger.
 *
 * `./reservation.ts` settles a numberless reservation automatically on the next create attempt. This verb
 * exists for the two cases that path cannot settle: the verifying read failed there, or the branch pair is
 * ambiguous and no code may guess. It makes the same one read and applies the same rules, so an operator gets
 * the machine's own judgement rather than a shell command with no opinion.
 *
 * Dispatched by `./run.ts` before `parseGithubPrArgs`, exactly where `request-review` and `retarget` are.
 */

import { githubToken, slopweaverHome } from "../../../config.js";
import { type GithubWriteApi, makeGithubWriteApi } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import { backfillPrIdentity, locusOf, readPrRecord, releasePrRecord } from "../../../outbound/github/prLedger.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { GITHUB_PR_RELEASE_RESERVATION_USAGE } from "./prUsage.js";
import { type GithubPrReleaseReservationArgs, parseGithubPrReleaseReservationArgs } from "./releaseReservationCore.js";
import {
  absenceReadFailedLine,
  absenceVerdictFor,
  ambiguousPairLine,
  backfilledNumberLine,
  qualifiedHeadRef,
  releasedOnAbsenceLine,
} from "./reservationAbsence.js";

/** Injectable edges, so a unit test drives this with plain functions and no network. */
export interface GithubPrReleaseReservationDeps {
  readonly home: () => string;
  /**
   * The client, narrowed to the ONE endpoint this verb reads.
   *
   * `Pick` rather than the whole `GithubWriteApi`: the narrowing is the contract — a verb that could reach
   * `createPr` or `mergePr` from here would be one refactor away from doing so — and it is also what lets a
   * unit test inject one function instead of restating forty unreachable stubs.
   */
  readonly makeApi: (args: { home: string; token: string }) => Pick<GithubWriteApi, "listPrs">;
  readonly now: () => Date;
  readonly out: (args: { line: string }) => void;
  readonly token: (args: { home: string }) => string | undefined;
  readonly writeDiagnostic: (args: { line: string }) => void;
}

/**
 * Settle the reservation for one branch locus against what GitHub reports on that pair.
 *
 * Never opens, closes or edits a pull request: one `pulls.list` GET, then at most one local record written.
 * Every non-zero exit here is a failure of FACT — the address is unusable, there is no token, the read did not
 * answer, or the pair carries more than one pull request — so none of them is a policy refusal with an
 * override to offer.
 *
 * @param deps the home resolver, client factory, clock and output seams
 * @param rest argv after `github pr release-reservation`
 * @returns the process exit code
 */
export async function runGithubPrReleaseReservation({
  deps,
  rest,
}: {
  deps: GithubPrReleaseReservationDeps;
  rest: readonly string[];
}): Promise<number> {
  const parsed = parseGithubPrReleaseReservationArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic({ line: problem });
    }
    deps.writeDiagnostic({ line: GITHUB_PR_RELEASE_RESERVATION_USAGE });
    return EXIT_USAGE;
  }
  const args: GithubPrReleaseReservationArgs = parsed.value;
  const home = homeFor({ args, deps });
  const locus = locusOf({ target: { base: args.base, head: args.head, owner: args.owner, repo: args.repo } });
  const record = readPrRecord({ home, locus });
  if (record === undefined) {
    deps.out({ line: `release-reservation: no reservation held for ${locus}` });
    return EXIT_OK;
  }
  if (record.number !== undefined) {
    deps.out({
      line:
        `release-reservation: ${locus} is held for #${String(record.number)}, which is not stranded — the ` +
        "create path releases it itself once GitHub reports that pull request closed or merged.",
    });
    return EXIT_OK;
  }
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic({ line: "release-reservation: no GitHub token — this verb has to read the branch pair" });
    return EXIT_ERROR;
  }
  return settle({ api: deps.makeApi({ home, token }), args, deps, home, locus });
}

/** The state home this invocation reads and writes: `--home` when given, the ambient one otherwise. */
function homeFor({
  args,
  deps,
}: {
  args: GithubPrReleaseReservationArgs;
  deps: GithubPrReleaseReservationDeps;
}): string {
  if (args.home !== undefined) {
    return args.home;
  }
  return deps.home();
}

/**
 * Ask GitHub what is on the branch pair, and act on the answer.
 *
 * @param api the client, narrowed to the ONE read this verb makes
 * @param args the resolved locus address
 * @param deps the clock and output seams
 * @param home the state home the record lives in
 * @param locus the branch locus the record is keyed by
 * @returns the process exit code
 */
async function settle({
  api,
  args,
  deps,
  home,
  locus,
}: {
  api: Pick<GithubWriteApi, "listPrs">;
  args: GithubPrReleaseReservationArgs;
  deps: GithubPrReleaseReservationDeps;
  home: string;
  locus: string;
}): Promise<number> {
  const listed = await api.listPrs({
    base: args.base,
    head: qualifiedHeadRef({ head: args.head, owner: args.owner }),
    owner: args.owner,
    repo: args.repo,
  });
  if (listed.isErr()) {
    deps.writeDiagnostic({ line: absenceReadFailedLine({ locus, message: listed.error.message }) });
    return EXIT_ERROR;
  }
  const verdict = absenceVerdictFor({ candidates: listed.value });
  if (verdict.kind === "ambiguous") {
    deps.writeDiagnostic({ line: ambiguousPairLine({ count: verdict.count, locus }) });
    return EXIT_ERROR;
  }
  if (verdict.kind === "absent") {
    deps.out({ line: releasedOnAbsenceLine({ locus }) });
    releasePrRecord({ home, locus });
    return EXIT_OK;
  }
  const found = verdict.pr;
  deps.out({ line: backfilledNumberLine({ locus, number: found.number }) });
  backfillPrIdentity({
    home,
    locus,
    nodeId: found.nodeId,
    nowIso: deps.now().toISOString(),
    number: found.number,
    storedBody: found.body,
  });
  deps.out({
    line:
      `release-reservation: ${locus} was NOT released — #${String(found.number)} is ${found.state} on these ` +
      "branches, so the reservation now names it.",
  });
  return EXIT_OK;
}

/**
 * Production home, token, client and output seams.
 *
 * @returns the real edges for the release-reservation verb
 */
export function productionGithubPrReleaseReservationDeps(): GithubPrReleaseReservationDeps {
  return {
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    now: () => new Date(),
    out: logger.out,
    token: githubToken,
    writeDiagnostic: ({ line }) => {
      logger.warn({ msg: line });
    },
  };
}
