/**
 * Effectful shell for the governed GitHub reviewer-request write.
 *
 * The order matches every other write in this directory: parse → resolve every login against the directory
 * (pure, no network) → token → read the pull request and settle authorisation → preflight (who is already
 * requested) → [dry-run stops here] → door → re-read for freshness → write → read-back → confirm → report.
 *
 * Split into one function per phase — `resolveReviewers`/`authorisePr`/`currentlyMissing`/`requestAndConfirm`
 * — rather than one long body, so each phase's own early-return shape stays readable and the whole shell
 * stays under this repo's per-function size and complexity ceilings.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { GithubWriteApi, RequestedReviewers, WrittenPr } from "../../../corpus/github/write.js";
import { err } from "../../../lib/result.js";
import {
  type ReviewerResolution,
  reviewerRefusals,
  staleReviewerRefusals,
} from "../../../outbound/github/reviewerIndex.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import { findingRulingGateRefused } from "./findingRulingGate.js";
import type { GithubPrDeps } from "./prDeps.js";
import { GITHUB_PR_REQUEST_REVIEW_USAGE } from "./prUsage.js";
import {
  type GithubPrRequestReviewArgs,
  parseGithubPrRequestReviewArgs,
  requestedReviewersLine,
  requestReviewDoorRequest,
  reviewRequestFreshnessFor,
} from "./requestReviewCore.js";
import { readPr, readRequested } from "./requestReviewReads.js";
import { reviewersFromIdentity, reviewersFromIdentityUnrefreshed } from "./reviewerWiring.js";
import { ALLOW_FOREIGN_PR, authorisationFor } from "./updateCore.js";

/** Print every line to the diagnostic sink, in order. */
function printAll({ deps, lines }: { deps: GithubPrDeps; lines: readonly string[] }): void {
  for (const line of lines) {
    deps.err({ line });
  }
}

/** Fold to a case-insensitive membership set, matching GitHub's own case-insensitive logins and slugs. */
function foldedSet({ values }: { values: readonly string[] }): ReadonlySet<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

/** Every resolved target not already present in `already`, folding case for the comparison only. */
function notAlreadyRequested({
  resolved,
  already,
}: {
  resolved: readonly string[];
  already: readonly string[];
}): readonly string[] {
  const present = foldedSet({ values: already });
  return resolved.filter((value) => !present.has(value.toLowerCase()));
}

/**
 * Every roster refusal across every requested login, in order.
 *
 * `checkStaleness` is false on the dry-run path — {@link reviewersFromIdentityUnrefreshed} never attempted a
 * refresh, so treating a stale-but-unrefreshed roster as a hard refusal there would be reporting a refresh
 * failure that never happened. Only the live path, which DID just attempt one via
 * {@link reviewersFromIdentity}, may conclude the roster is unusably stale.
 */
function rosterRefusals({
  resolutions,
  logins,
  checkStaleness,
}: {
  resolutions: readonly ReviewerResolution[];
  logins: readonly string[];
  checkStaleness: boolean;
}): readonly string[] {
  return [
    ...resolutions.flatMap((resolution, index) => reviewerRefusals({ login: logins[index]!, resolution })),
    ...(checkStaleness ? staleReviewerRefusals({ resolutions }) : []),
  ];
}

/**
 * Resolve every requested `--reviewer` login against the directory, before any GitHub call.
 *
 * @returns the resolved logins (GitHub's own casing), or undefined once every refusal — the store's own
 *   included — has been printed
 */
async function resolveReviewers({
  args,
  deps,
  home,
}: {
  args: GithubPrRequestReviewArgs;
  deps: GithubPrDeps;
  home: string;
}): Promise<readonly string[] | undefined> {
  const { identityRoster } = deps;
  const resolved = args.dryRun
    ? await reviewersFromIdentityUnrefreshed({ home, identityRoster, logins: args.reviewers })
    : await reviewersFromIdentity({
        askedAtIso: new Date().toISOString(),
        home,
        identityRoster,
        logins: args.reviewers,
      });
  if (resolved.isErr()) {
    printAll({ deps, lines: [resolved.error.message] });
    return undefined;
  }
  const resolutions = resolved.value;
  const refusals = rosterRefusals({ checkStaleness: !args.dryRun, logins: args.reviewers, resolutions });
  if (refusals.length > 0) {
    printAll({ deps, lines: refusals });
    return undefined;
  }
  return resolutions.map((resolution) => resolution.target!.login);
}

/**
 * Read the pull request and settle whether this caller may request review on it.
 *
 * @returns the pull request as read, or undefined once the read or authorisation refusal has been printed
 */
async function authorisePr({
  api,
  args,
  deps,
  home,
}: {
  api: GithubWriteApi;
  args: GithubPrRequestReviewArgs;
  deps: GithubPrDeps;
  home: string;
}): Promise<WrittenPr | undefined> {
  const previewed = await readPr({ api, args });
  if (previewed.isErr()) {
    printAll({ deps, lines: githubVerbErrorLines({ error: previewed.error }) });
    return undefined;
  }
  // A review ask is the most team-facing thing a session can do with a pull request, so a fleet finding the owner
  // has not ruled on is refused here too — an owner ruling.
  if (
    await findingRulingGateRefused({
      action: `ask a teammate to review #${String(args.number)}`,
      autonomy: deps.autonomy,
      head: previewed.value.head.ref,
      home,
      out: deps.err,
    })
  ) {
    return undefined;
  }
  const identity = await api.authenticatedUserId();
  const authorised = authorisationFor({
    allowForeign: deps.env({ name: ALLOW_FOREIGN_PR }) === "1",
    authedUserId: identity.isOk() ? identity.value : undefined,
    prAuthorId: previewed.value.authorId,
    purpose: "request-review",
  });
  if (authorised.kind === "refused") {
    deps.err({ line: authorised.reason });
    return undefined;
  }
  if (authorised.kind === "overridden") {
    deps.out({ line: authorised.notice });
  }
  return previewed.value;
}

/** What's left to request, after reading the pull request's currently requested reviewers. */
interface MissingReviewers {
  readonly current: RequestedReviewers;
  readonly missingUsers: readonly string[];
  readonly missingTeams: readonly string[];
}

/**
 * Read the pull request's current reviewers and work out what this write would still add.
 *
 * @returns the current state plus what is missing, or undefined once the read's refusal has been printed
 */
async function currentlyMissing({
  api,
  args,
  resolvedLogins,
  deps,
}: {
  api: GithubWriteApi;
  args: GithubPrRequestReviewArgs;
  resolvedLogins: readonly string[];
  deps: GithubPrDeps;
}): Promise<MissingReviewers | undefined> {
  const requested = await readRequested({ api, args });
  if (requested.isErr()) {
    printAll({ deps, lines: githubVerbErrorLines({ error: requested.error }) });
    return undefined;
  }
  return {
    current: requested.value,
    missingTeams: notAlreadyRequested({ already: requested.value.teams, resolved: args.teams }),
    missingUsers: notAlreadyRequested({ already: requested.value.users, resolved: resolvedLogins }),
  };
}

/** Send the request once and confirm every requested login and team by read-back. */
async function requestAndConfirm({
  api,
  args,
  previewed,
  missingUsers,
  missingTeams,
}: {
  api: GithubWriteApi;
  args: GithubPrRequestReviewArgs;
  previewed: WrittenPr;
  missingUsers: readonly string[];
  missingTeams: readonly string[];
}): Promise<GithubVerbResult<RequestedReviewers>> {
  const current = await readPr({ api, args });
  if (current.isErr()) {
    return err(current.error);
  }
  const freshness = reviewRequestFreshnessFor({ current: current.value, previewed });
  if (!freshness.fresh) {
    return err(GithubVerbErrors.factRefused({ reason: freshness.reason, subject: `#${String(args.number)}` }));
  }
  const written = await api.requestReviewers({
    number: args.number,
    owner: args.owner,
    repo: args.repo,
    reviewers: missingUsers,
    teamReviewers: missingTeams,
  });
  if (written.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "request reviewers", reasons: [written.error.message] }));
  }
  const after = await readRequested({ api, args });
  if (after.isErr()) {
    return after;
  }
  const stillMissing = [
    ...notAlreadyRequested({ already: after.value.users, resolved: missingUsers }),
    ...notAlreadyRequested({ already: after.value.teams, resolved: missingTeams }),
  ];
  return stillMissing.length === 0
    ? after
    : err(GithubVerbErrors.reviewRequestUnconfirmed({ missing: stillMissing, number: args.number }));
}

/** Print one result in the selected output mode. */
function report({
  deps,
  args,
  requested,
  outcome,
}: {
  deps: GithubPrDeps;
  args: GithubPrRequestReviewArgs;
  requested: RequestedReviewers;
  outcome: string;
}): void {
  const line = requestedReviewersLine({ number: args.number, outcome, requested });
  deps.out({
    line: args.json ? JSON.stringify({ outcome, requested }, undefined, 2) : line,
  });
}

/** Send the write through the door, and report the confirmed or refused outcome. */
async function performWrite({
  api,
  args,
  home,
  missing,
  previewed,
  deps,
}: {
  api: GithubWriteApi;
  args: GithubPrRequestReviewArgs;
  home: string;
  missing: MissingReviewers;
  previewed: WrittenPr;
  deps: GithubPrDeps;
}): Promise<number> {
  const { missingTeams, missingUsers } = missing;
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => requestAndConfirm({ api, args, missingTeams, missingUsers, previewed }),
    request: requestReviewDoorRequest({ args, home }),
  });
  if (!through.performed) {
    const refusal = notPerformedLines({ command: "slopweaver github pr request-review", through });
    printAll({ deps, lines: refusal });
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    printAll({ deps, lines: githubVerbErrorLines({ error: through.result.error }) });
    return EXIT_ERROR;
  }
  report({ args, deps, outcome: "requested", requested: through.result.value });
  return EXIT_OK;
}

/**
 * Run the review-request.
 *
 * @param rest argv after `github pr request-review`
 * @param deps the shared `github pr` injectable edges — token, API factory, output and diagnostic sinks
 * @returns the process exit code
 */
export async function runGithubPrRequestReview({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubPrDeps;
}): Promise<number> {
  const parsed = parseGithubPrRequestReviewArgs({ rest });
  if (parsed.isErr()) {
    printAll({ deps, lines: parsed.error });
    deps.err({ line: GITHUB_PR_REQUEST_REVIEW_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });

  const resolvedLogins = await resolveReviewers({ args, deps, home });
  if (resolvedLogins === undefined) {
    return EXIT_ERROR;
  }

  const token = deps.token({ home });
  if (token === undefined) {
    deps.err({ line: "no GitHub token configured; run `slopweaver connect github`" });
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });

  const previewed = await authorisePr({ api, args, deps, home });
  if (previewed === undefined) {
    return EXIT_ERROR;
  }

  const missing = await currentlyMissing({ api, args, deps, resolvedLogins });
  if (missing === undefined) {
    return EXIT_ERROR;
  }
  if (missing.missingUsers.length === 0 && missing.missingTeams.length === 0) {
    report({ args, deps, outcome: "already requested", requested: missing.current });
    return EXIT_OK;
  }
  if (args.dryRun) {
    report({
      args,
      deps,
      outcome: "would request",
      requested: { teams: missing.missingTeams, users: missing.missingUsers },
    });
    return EXIT_OK;
  }

  return performWrite({ api, args, deps, home, missing, previewed });
}
