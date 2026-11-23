/**
 * Effectful shell for `slopweaver github pr reviewers`: REST reads of the pull request, every changed path and
 * the CODEOWNERS on its BASE branch (the file GitHub itself applies), in `./prReviewersReads.ts`, then the pure
 * derivation and report in `./prReviewersCore.ts`.
 *
 * Read-only. A C3 description publishes no reviewer table, so `--apply` is refused rather than writing one.
 *
 * Dispatched by `./run.ts` before `parseGithubPrArgs`, exactly where `standing` is.
 */
import { err, ok, type Result } from "#lib/result.js";
import { githubToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { GithubReadRest } from "../../../live/github/read.js";
import { githubReadRest, parseGithubReadAddress } from "../../../live/github/read.js";
import { type ReviewerResolution, reviewerRefusals } from "../../../outbound/github/reviewerIndex.js";
import {
  type DerivedReviewerTable,
  deriveReviewerTable,
  type ReviewerPick,
} from "../../../outbound/github/reviewerTable.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  type GithubPrReviewersArgs,
  githubPrReviewersReportOf,
  type PrReviewersFacts,
  parseGithubPrReviewersArgs,
  REVIEWERS_APPLY_RETIRED,
  renderGithubPrReviewersText,
} from "./prReviewersCore.js";
import {
  changedPaths,
  codeownersAt,
  codeownersErrorLines,
  factsAt,
  movedSince,
  type PrAt,
} from "./prReviewersReads.js";
import { GITHUB_PR_REVIEWERS_USAGE } from "./prUsage.js";
import { reviewersFromIdentityUnrefreshed } from "./reviewerWiring.js";

/** Injectable edges, so a unit test drives this with plain functions and no network. */
export interface GithubPrReviewersDeps {
  readonly rest: (args: { home: string | undefined }) => GithubReadRest;
  /** Resolve each picked person through the confirmed roster, as it stands. */
  readonly resolveLogins: (args: {
    home: string;
    logins: readonly string[];
  }) => Promise<Result<readonly ReviewerResolution[], IdentityRosterError>>;
  readonly out: (args: { line: string }) => void;
  readonly writeDiagnostic: (args: { line: string }) => void;
}

/** What the table derives from, every read of it done. */
interface DerivationReads {
  readonly paths: readonly string[];
  readonly codeowners: { readonly path: string; readonly text: string };
  readonly erroredLines: readonly number[];
}

/** Print why the run stopped, and name its exit code. */
function refused({ deps, line }: { deps: GithubPrReviewersDeps; line: string }): Result<never, number> {
  deps.writeDiagnostic({ line });
  return err(EXIT_ERROR);
}

/** The parsed arguments and the pull request they address, or the usage exit once its refusal is printed. */
function targetOf({
  deps,
  rest,
}: {
  deps: GithubPrReviewersDeps;
  rest: readonly string[];
}): Result<{ args: GithubPrReviewersArgs; at: PrAt }, number> {
  const parsed = parseGithubPrReviewersArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [...parsed.error, GITHUB_PR_REVIEWERS_USAGE]) {
      deps.writeDiagnostic({ line: problem });
    }
    return err(EXIT_USAGE);
  }
  // A C3 description publishes no reviewer table, so there is nothing for `--apply` to write: it is refused here,
  // before any read, rather than after a derivation the caller asked for only to have it written.
  if (parsed.value.apply) {
    deps.writeDiagnostic({ line: `refused: ${REVIEWERS_APPLY_RETIRED}` });
    return err(EXIT_USAGE);
  }
  const address = parseGithubReadAddress({ address: parsed.value.url });
  if (address.isErr()) {
    deps.writeDiagnostic({ line: address.error.message });
    return err(EXIT_USAGE);
  }
  if (address.value.kind !== "pull-request") {
    deps.writeDiagnostic({ line: `${parsed.value.url} is not a pull-request address` });
    return err(EXIT_USAGE);
  }
  const { number, owner, repo } = address.value;
  return ok({ args: parsed.value, at: { number, owner, repo, rest: deps.rest({ home: parsed.value.home }) } });
}

/** The changed paths, the base's CODEOWNERS and the lines GitHub reports an error on, or the exit once printed. */
async function derivationReads({
  at,
  deps,
  facts,
}: {
  at: PrAt;
  deps: GithubPrReviewersDeps;
  facts: PrReviewersFacts;
}): Promise<Result<DerivationReads, number>> {
  const paths = await changedPaths({ at, facts });
  if (typeof paths === "string") {
    return refused({ deps, line: paths });
  }
  const codeowners = await codeownersAt({ at, ref: facts.base });
  if (typeof codeowners === "string") {
    return refused({ deps, line: codeowners });
  }
  if (codeowners === undefined) {
    deps.out({
      line: `${at.owner}/${at.repo} has no CODEOWNERS on ${facts.base}, so nobody owns a file and there is no table`,
    });
    return err(EXIT_EXPECTED_EMPTY);
  }
  // GitHub ignores an owner it cannot resolve or who lacks write access, and a line it cannot read. It says which
  // lines, so the table refuses a file such a line decides instead of re-deriving GitHub's access rules.
  const erroredLines = await codeownersErrorLines({ at, path: codeowners.path, ref: facts.base });
  if (typeof erroredLines === "string") {
    return refused({ deps, line: erroredLines });
  }
  return ok({ codeowners, erroredLines, paths });
}

/** Every pick with its person resolved to the confirmed login, or each refusal. */
async function confirmedPicks({
  deps,
  home,
  picks,
}: {
  deps: GithubPrReviewersDeps;
  home: string;
  picks: readonly ReviewerPick[];
}): Promise<Result<readonly ReviewerPick[]>> {
  if (picks.length === 0) {
    return ok([]);
  }
  const logins = picks.map((pick) => pick.person.slice(1));
  const resolved = await deps.resolveLogins({ home, logins });
  if (resolved.isErr()) {
    return err([resolved.error.message]);
  }
  const resolutions = resolved.value;
  const refusals = logins.flatMap((login, index) => reviewerRefusals({ login, resolution: resolutions[index]! }));
  if (refusals.length > 0) {
    return err(refusals);
  }
  return ok(picks.map((pick, index) => ({ owner: pick.owner, person: `@${resolutions[index]!.target!.login}` })));
}

/** Print the report, and name the exit its derivation earned. */
function report({
  args,
  codeownersPath,
  deps,
  derived,
  facts,
}: {
  args: GithubPrReviewersArgs;
  codeownersPath: string;
  deps: GithubPrReviewersDeps;
  derived: DerivedReviewerTable;
  facts: PrReviewersFacts;
}): number {
  const reported = githubPrReviewersReportOf({
    changedFiles: facts.changedFiles,
    codeownersPath,
    derived,
    url: args.url,
  });
  const lines = args.json ? [JSON.stringify(reported)] : renderGithubPrReviewersText({ report: reported });
  for (const line of lines) {
    deps.out({ line });
  }
  if (reported.refusal !== undefined) {
    return EXIT_ERROR;
  }
  return derived.kind === "table" ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Derive one pull request's Who reviews what table and print it.
 *
 * @param deps the read seams, roster and output
 * @param rest argv after `github pr reviewers`
 * @returns the process exit code
 */
export async function runGithubPrReviewers({
  deps,
  rest,
}: {
  deps: GithubPrReviewersDeps;
  rest: readonly string[];
}): Promise<number> {
  const target = targetOf({ deps, rest });
  if (target.isErr()) {
    return target.error;
  }
  const { args, at } = target.value;
  const facts = await factsAt({ at, url: args.url });
  if (typeof facts === "string") {
    deps.writeDiagnostic({ line: facts });
    return EXIT_ERROR;
  }
  const reads = await derivationReads({ at, deps, facts });
  if (reads.isErr()) {
    return reads.error;
  }
  // After every read the table derives from, so a derivation read that refuses leaves the roster unread.
  const confirmed = await confirmedPicks({ deps, home: resolveHome({ named: args.home }), picks: args.picks });
  if (confirmed.isErr()) {
    for (const line of confirmed.error) {
      deps.writeDiagnostic({ line });
    }
    return EXIT_ERROR;
  }
  // Past 300 files the list is not pinned to a commit, and CODEOWNERS is read at the base BRANCH, so a push between
  // the first read and them would cut a table the recorded commits never had. The pull request is read again and
  // nothing is printed if it moved.
  if (movedSince({ first: facts, now: await factsAt({ at, url: args.url }) })) {
    deps.writeDiagnostic({
      line: `${args.url} moved while the table was derived (head ${facts.headSha.slice(0, 9)} read first), so nothing was printed or written. Run it again`,
    });
    return EXIT_ERROR;
  }
  const { codeowners, erroredLines, paths } = reads.value;
  const derived = deriveReviewerTable({
    authorLogin: facts.authorLogin,
    codeowners: codeowners.text,
    erroredLines,
    paths,
    picks: confirmed.value,
  });
  return report({ args, codeownersPath: `${codeowners.path}@${facts.base}`, deps, derived, facts });
}

/**
 * Production edges: the credential resolves from the named home, and every read goes through the provider door.
 * The roster is read as it stands, never refreshed, since this verb writes nothing.
 *
 * @returns the deps
 */
export function productionGithubPrReviewersDeps(): GithubPrReviewersDeps {
  return {
    out: logger.out,
    resolveLogins: ({ home, logins }) =>
      reviewersFromIdentityUnrefreshed({ home, identityRoster: identityRosterPort(), logins }),
    rest: ({ home }) => githubReadRest({ token: githubToken(home === undefined ? {} : { home }) }),
    writeDiagnostic: ({ line }) => {
      logger.warn({ msg: line });
    },
  };
}
