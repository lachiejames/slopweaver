/**
 * Settling the landing rows whose pull request has ended — the other half of `--register`.
 *
 * `./landingRegister.ts` puts a row on the board for every open pull request that needs a seat; nothing took one
 * OFF when the pull request merged or closed, because the read only ever sees open ones. Which rows are candidates,
 * why only `ready` ones, and why the settlement is `answered` all live in `../../../review/landingClosure.ts`; this
 * file owns the reads and the writes.
 *
 * It rides `--register` rather than a flag of its own: registering a row and settling it are one register's two
 * ends, and the supervisor tick already passes `--register` (sweep-contract step 7), so a second flag would be one
 * more thing a tick has to remember to say.
 */

import { githubToken, parseRepositorySlug } from "../../../config.js";
import type { RunDisposition } from "../../../handover/boardTypes.js";
import { readExactDoc } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../live/github/errors.js";
import type { RepoCensus } from "../../../live/github/openCensus.js";
import { makeFetchPrClosure, type PrClosure } from "../../../live/github/prClosure.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { closureRowState, closureSettlePrecondition } from "../../../review/closureRowState.js";
import type { LandingRow } from "../../../review/landing.js";
import type { LandingBoardRow } from "../../../review/landingBoard.js";
import {
  closureCandidates,
  closureHeldWhy,
  closureSettleArgv,
  closureWitness,
} from "../../../review/landingClosure.js";
import { stateHomePaths } from "../../../stateHome.js";
import { settleAskRow } from "../handover/settleRowRun.js";
import { type LandingRegisterDeps, type LandingRegistration, performRegistrations } from "./landingRegister.js";
import { CLOSURE_CAP } from "./landingUsage.js";

/** What happened to one landing row whose pull request the open census no longer lists. */
export interface LandingSettlement {
  readonly repoSlug: string;
  readonly number: number;
  readonly slug: string;
  readonly outcome: "settled" | "would-settle" | "held" | "skipped" | "failed";
  readonly detail: string;
}

/** The edges {@link performClosures} reads and writes through. */
export interface LandingClosureDeps {
  /**
   * Every handover row with a stated branch (declared `branch:` or its run's recorded one), keyed by each, with
   * its DERIVED status. One row may sit under two keys; the closure reader de-duplicates by slug.
   */
  readonly boardBranches: (args: { home: string | undefined }) => ReadonlyMap<string, readonly LandingBoardRow[]>;
  /** What GitHub says about one pull request now: open, or what ended it. */
  readonly prClosure: (args: {
    home: string | undefined;
    repoSlug: string;
    number: number;
  }) => Promise<Result<PrClosure, GithubLiveError>>;
  /** One row's DERIVED status and run as they read NOW, or undefined when it is no longer a readable live row. */
  readonly rowNow: (args: {
    home: string | undefined;
    slug: string;
  }) => { readonly status: string; readonly run: RunDisposition["kind"] } | undefined;
  /** Settle one row through `handover settle`. Returns its exit code; `quiet` keeps its receipt off stdout. */
  readonly settleRow: (args: { argv: readonly string[]; quiet: boolean }) => Promise<number>;
}

/**
 * The live read, the one-row re-read and the in-process settle, for the production landing deps.
 *
 * @returns the per-pull-request GitHub read, the row re-read and the `handover settle` write, its receipt on
 *   stderr when `quiet`
 */
export function productionLandingClosureDeps(): Pick<LandingClosureDeps, "prClosure" | "rowNow" | "settleRow"> {
  return {
    rowNow: ({ home, slug }) => {
      const paths = stateHomePaths(home === undefined ? {} : { home });
      const found = readExactDoc({ handoverDir: paths.handovers, slug });
      if (found.isErr() || found.value === undefined || found.value.archived) {
        return undefined;
      }
      return closureRowState({ doc: found.value.doc, runsDir: paths.runs });
    },
    prClosure: ({ home, repoSlug, number }) => {
      const slug = parseRepositorySlug({ slug: repoSlug });
      if (slug.isErr()) {
        return Promise.resolve(err(GithubLiveErrors.invalidAddress({ message: slug.error.join("; ") })));
      }
      const graphql = githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) });
      return makeFetchPrClosure({ graphql })({ number, owner: slug.value.owner, repo: slug.value.repo });
    },
    settleRow: ({ argv, quiet }) =>
      settleAskRow({
        argv,
        // The eligibility judged again over the bytes the settle splices, nothing awaited before its write: the
        // re-read in `settleOne` names a hold cleanly, and this stops a row reached after that re-read.
        precondition: closureSettlePrecondition,
        out: quiet
          ? ({ line }) => {
              logger.warn({ msg: line });
            }
          : logger.out,
      }),
  };
}

/**
 * Both ends of `--register`: a row for every dispatchable, then a settlement for every row whose pull request ended.
 *
 * In that order, so a row this pass wrote is never read back as one to settle: it is about an OPEN pull request,
 * which the census lists.
 *
 * @param document the landing read's dispatchable rows and its open census, read on this same pass
 * @param repos the `owner/name`s this read selected
 * @param dryRun describe every write and make none
 * @param home the state home the board lives under
 * @param quiet whether a child verb's receipt must stay off stdout, under `--json`
 * @param deps the board read, the per-pull-request read and both writes
 * @returns the registrations and the settlements, each in the order considered
 */
export async function performRegisterWrites({
  document,
  repos,
  dryRun,
  home,
  quiet,
  deps,
}: {
  document: { readonly dispatchable: readonly LandingRow[]; readonly census: readonly RepoCensus[] };
  repos: readonly string[];
  dryRun: boolean;
  home: string | undefined;
  quiet: boolean;
  deps: LandingClosureDeps & LandingRegisterDeps;
}): Promise<{
  readonly registrations: readonly LandingRegistration[];
  readonly settlements: readonly LandingSettlement[];
}> {
  const { dispatchable, census } = document;
  const registrations = await performRegistrations({ deps, dispatchable, dryRun, home, quiet });
  const settlements = await performClosures({ census, deps, dryRun, home, quiet, repos });
  return { registrations, settlements };
}

/**
 * Read and settle every `ready` landing row whose pull request has ended, capped.
 *
 * @param census GitHub's open list per selected repository, read on this same pass
 * @param repos the `owner/name`s this read selected
 * @param dryRun read GitHub and describe every settle, writing none
 * @param home the state home the board lives under
 * @param quiet whether `handover settle`'s receipt must stay off stdout, under `--json`
 * @param deps the board read, the per-pull-request read and the settle write
 * @returns one outcome per row whose pull request the census no longer lists
 */
export async function performClosures({
  census,
  repos,
  dryRun,
  home,
  quiet,
  deps,
}: {
  census: readonly RepoCensus[];
  repos: readonly string[];
  dryRun: boolean;
  home: string | undefined;
  quiet: boolean;
  deps: LandingClosureDeps;
}): Promise<readonly LandingSettlement[]> {
  const rows = [...deps.boardBranches({ home }).values()].flat();
  const { candidates, held } = closureCandidates({ census, repos, rows });
  const outcomes: LandingSettlement[] = held.map(({ why, ...candidate }) => ({
    ...candidate,
    detail: why,
    outcome: "held",
  }));
  for (const [index, candidate] of candidates.entries()) {
    if (index >= CLOSURE_CAP) {
      outcomes.push({
        ...candidate,
        detail: `this invocation's cap of ${String(CLOSURE_CAP)} reads was already reached — the next read takes it`,
        outcome: "skipped",
      });
      continue;
    }
    outcomes.push(await settleOne({ candidate, deps, dryRun, home, quiet }));
  }
  return outcomes;
}

/** Read one candidate's pull request, and settle its row when GitHub says it ended. */
async function settleOne({
  candidate,
  deps,
  dryRun,
  home,
  quiet,
}: {
  candidate: { readonly slug: string; readonly repoSlug: string; readonly number: number };
  deps: LandingClosureDeps;
  dryRun: boolean;
  home: string | undefined;
  quiet: boolean;
}): Promise<LandingSettlement> {
  const read = await deps.prClosure({ home, number: candidate.number, repoSlug: candidate.repoSlug });
  if (read.isErr()) {
    return { ...candidate, detail: `could not read it: ${read.error.message}`, outcome: "failed" };
  }
  const witness = closureWitness({ closure: read.value });
  if (witness === undefined) {
    return {
      ...candidate,
      detail: "GitHub still reads it OPEN although the census did not list it — left for the next read",
      outcome: "skipped",
    };
  }
  if (dryRun) {
    return { ...candidate, detail: witness, outcome: "would-settle" };
  }
  // The board snapshot predates a network read, and `handover settle` checks no status of its own, so a row paused
  // while GitHub answered would be settled from stale eligibility. Re-read the one row and ask again.
  const now = deps.rowNow({ home, slug: candidate.slug });
  const lateWhy = now === undefined ? "it no longer reads as a live row on the board" : closureHeldWhy(now);
  if (lateWhy !== undefined) {
    return { ...candidate, detail: `re-read once GitHub answered: ${lateWhy}`, outcome: "held" };
  }
  const code = await deps.settleRow({ argv: closureSettleArgv({ home, slug: candidate.slug, witness }), quiet });
  if (code !== 0) {
    // Not "nothing was written": the verb writes the row BEFORE its mirror and run-residue steps, either of which can
    // still exit nonzero, so the next read re-reads the board rather than this line asserting either way.
    return {
      ...candidate,
      detail:
        `\`handover settle\` exited ${String(code)} — its own lines above name the cause, and the row may already ` +
        "be settled if it failed after the write",
      outcome: "failed",
    };
  }
  return { ...candidate, detail: `settled answered — ${witness}`, outcome: "settled" };
}
