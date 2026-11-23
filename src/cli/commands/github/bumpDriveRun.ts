/**
 * The effectful shell for `slopweaver github bump-drive` — the verb an automation fires.
 *
 * The owner wants scheduled asks that take dependency bump pull requests over the line, because too many
 * pull requests sit open.
 *
 * ## Why this is a verb at all, when `github landing --press` already presses
 *
 * Because `github landing` cannot SEE this population. MEASURED with
 * `slopweaver github bottleneck --repo lachiejames/slopweaver`: 15 of 24 open pull requests were drafts, ten of
 * them the organisation's own Renovate App's, and `renovate.json` sets `draftPR: true` — while `github landing` excludes
 * drafts by default and `merge-now` is defined as all six tests passing, which a draft cannot do. So every
 * renovate bump on this repository was invisible to the verb that presses and invisible to the sweep that
 * reads it. Four of the ten would have landed the moment somebody undrafted them.
 *
 * `undraft-and-enqueue` is the act that was missing, and this verb exists to have somewhere to put it.
 *
 * ## What it does NOT do, each for a stated reason
 *
 * - **It does not rebase.** A rebase is a working tree, a conflict resolution and a force-push — real work,
 *   and the doctrine for real work is a session (`AGENTS.md` rule 10), so a bump behind its base becomes a
 *   BOARD ROW. A verb that force-pushed a bot's branch unattended is the shape rule 2 and rule 10 both refuse.
 * - **It does not re-run red CI, and it repairs exactly one red check.** A check that failed on a bump is a
 *   real signal about a dependency, and a retry loop would hide exactly the upgrade that should not land — so
 *   there is no retry here at all. `dev-gate` alone is different in kind: its subject is the DESCRIPTION, and
 *   renovate's template can never satisfy the description origin rule, so that red is a fact about this repository's
 *   own gate rather than about the dependency. `rewrite-body` recomposes the body from
 *   `../../../outbound/github/bumpBodyForm.ts` and sends it through the verb that owns descriptions, ONCE per
 *   head. `../../../review/bumpSelection.ts`'s `bodyRewriteClears` is the whole criterion, and every other
 *   red check is still a seat.
 * - **It does not name a single `github enqueue` finding for itself.** `./landingPress.ts` may, off a standing
 *   human approval; a bot's pull request nobody approved is precisely the row that must not inherit that.
 * - **It makes no pull-request read of its own**, exactly as `./bottleneckRun.ts` makes none: the input is
 *   `./landingRun.ts`'s `readLandingRows`, so the selection, the audit and the act cannot disagree about what
 *   a pull request's state is. The one read it adds is a repository's RESOLUTION, asked only of a repository
 *   that read returned no row for, because a search answers a slug GitHub cannot resolve with an empty list, and
 *   a pass that reported that as "0 open" would let any wrong slug read as a quiet zero
 *   (`./repositoryResolutionGate.ts`). One that does not resolve stops the pass before anything is closed or pressed.
 *
 * What is left is what one unattended pass can finish and prove: undraft, enqueue, seat, and say so.
 */

import { githubToken } from "../../../config.js";
import { unrootedBriefPathRefusal } from "../../../handover/briefPathGate.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { resolveGithubRepository } from "../../../live/github/repositoryResolution.js";
import type { Organisation } from "../../../organisation/core.js";
import { dependencyBotsOf } from "../../../organisation/dependencyBots.js";
import type { OrganisationError } from "../../../organisation/errors.js";
import { bumpPlans, selectBumpRows } from "../../../review/bumpSelection.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { performBumpActs } from "./bumpDriveActs.js";
import { type BumpCloseDeps, productionBumpCloseDeps, runSupersedePass, supersedeKey } from "./bumpDriveClose.js";
import {
  BUMP_REWRITE_HATCHES,
  type GithubBumpDriveArgs,
  parseGithubBumpDriveArgs,
  scheduleBumpActs,
} from "./bumpDriveCore.js";
import { bumpDriveDocument, bumpDriveLines } from "./bumpDriveReport.js";
import { githubBumpDriveUsage } from "./bumpDriveUsage.js";
import type { GithubLandingArgs } from "./landingCore.js";
import { productionGithubLandingDeps } from "./landingDeps.js";
import { type GithubLandingDeps, resolveAndReadLandingRows } from "./landingRun.js";
import { type GithubPrDeps, productionGithubPrDeps } from "./prDeps.js";
import { productionGithubReadyDeps, runGithubReady } from "./readyRun.js";
import { type ResolveGithubRepository, repositoryResolutionRefusalLines } from "./repositoryResolutionGate.js";
import { runGithubPr } from "./run.js";

const VERB_ARG_OFFSET = 4;

/**
 * The edges this verb adds to the landing read's own.
 *
 * Each of the two WRITE seams runs a `slopweaver` verb in process for the same reason the press runs
 * `github enqueue` in process: that verb owns the door record and the read-back that proves GitHub actually
 * took the transition, and a second implementation of an undraft or a description PATCH would eventually
 * disagree with it. The ledger is read through the landing deps' own `ledgerActs`, which also asks whether a
 * row can be written: it is the rail before every act that owes one, and the rewrite's one-per-head guard
 * (`./bumpDriveLedger.ts`'s `bumpBodyWasRecorded`).
 */
export interface GithubBumpDriveDeps
  extends GithubLandingDeps, Pick<BumpCloseDeps, "ownOpenPrs" | "mergedRenovatePrs" | "closePr" | "recheckPr"> {
  /** Undraft one pull request, through the verb that owns undrafting. Returns its exit code. */
  readonly markReady: (args: { rest: readonly string[]; quiet: boolean }) => Promise<number>;
  /**
   * Replace one pull request's whole description, through `github pr update`. Returns its exit code.
   *
   * Takes the FULL argv, as `registerRow` does, because the child verb parses its own tail.
   */
  readonly rewriteBody: (args: { argv: readonly string[]; quiet: boolean }) => Promise<number>;
  /**
   * Whether `handover register`'s unrooted-path gate would refuse one seat's full `--ask`.
   *
   * Asked through the gate's own function, so a seat can withhold a pull request's name and title — provider
   * text such as `update datadog/agent` that names a state-home directory — rather than have the register
   * refuse the whole row at every firing. The gate itself is untouched.
   */
  readonly askUnrootable: (args: { ask: string; home: string | undefined; checkout: string | undefined }) => boolean;
  /** Whether GitHub resolves one repository, asked only of one the landing read returned no row for. */
  readonly resolveRepository: ResolveGithubRepository;
}

/**
 * The landing invocation this verb's flags imply.
 *
 * Drafts are always IN — a draft bump is the whole population this verb was written for — and every write flag
 * on the landing args is off, because the writes here are this shell's own and go through the verbs that own
 * them rather than through `github landing`'s press and register paths.
 *
 * @param args the parsed bump-drive invocation
 * @returns the landing args the shared read takes
 */
function asLandingArgs({ args }: { args: GithubBumpDriveArgs }): GithubLandingArgs {
  return {
    author: undefined,
    // A bump is a bot's pull request, never the owner's: neither own-work verdict may fire on one.
    authoredByOwner: false,
    cadenceMinutes: 0,
    draftsOnly: false,
    dryRun: false,
    full: false,
    home: args.home,
    ifDue: false,
    includeDrafts: true,
    json: true,
    limit: args.limit,
    optOutLabels: args.optOutLabels,
    pr: undefined,
    // Neither backlog verb takes `--record-reading`: the readings ledger names a PRODUCER, and both of these
    // print their own document rather than landing's. Giving each one its own producer is a follow-up row.
    recordReadingBy: undefined,
    press: false,
    register: false,
    repos: args.repos,
    slackLive: false,
  };
}

/**
 * Run one `github bump-drive` invocation against injected edges.
 *
 * @param rest argv after `github bump-drive`
 * @param deps the landing read's seams plus the one undraft edge
 * @returns the process exit code
 */
export async function runGithubBumpDrive({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubBumpDriveDeps;
}): Promise<number> {
  const parsed = parseGithubBumpDriveArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(githubBumpDriveUsage());
    return EXIT_USAGE;
  }
  const args = parsed.value;
  // ONE organisation read per pass: the repositories, the bots and every seat's workspace all answer from this
  // row, so a write landing mid-pass can never select under one revision and seat under another.
  const organisation = await deps.readOrganisation({ home: args.home });
  const pass: GithubBumpDriveDeps = { ...deps, readOrganisation: () => Promise.resolve(organisation) };
  return runPass({ args, deps: pass, organisation });
}

/** The pass itself, over seams whose organisation read is already the one captured for this run. */
async function runPass({
  args,
  deps,
  organisation,
}: {
  args: GithubBumpDriveArgs;
  deps: GithubBumpDriveDeps;
  organisation: Result<Organisation, OrganisationError>;
}): Promise<number> {
  const read = await resolveAndReadLandingRows({ args: asLandingArgs({ args }), deps });
  if (read.isErr()) {
    for (const problem of read.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  if (!(await allRepositoriesResolve({ deps, home: args.home, repos: read.value.repos, rows: read.value.rows }))) {
    return EXIT_ERROR;
  }
  // Who counts as a bump bot is the organisation's word. None configured runs on the generic Renovate and
  // Dependabot and says so in the report; one that will not read stops the pass, because reading it as "no bot
  // of its own" would leave that organisation's bumps unselected and its Renovate merges unsearched.
  const resolved = dependencyBotsOf({ organisation });
  if (resolved.isErr()) {
    deps.writeDiagnostic(
      `github bump-drive: which authors are dependency bots could not be read — ${resolved.error.message}`,
    );
    return EXIT_ERROR;
  }
  const { bots, note } = resolved.value;
  const superseded = await runSupersedePass({
    bots,
    deps,
    dryRun: args.dryRun,
    home: args.home,
    optOutLabels: args.optOutLabels,
    quiet: args.json,
    repos: read.value.repos,
  });
  const bumps = selectBumpRows({ bots, rows: read.value.rows }).filter(
    (bump) => !superseded.closing.has(supersedeKey(bump.row)),
  );
  const scheduled = scheduleBumpActs({ plans: bumpPlans({ bots, bumps, optOutLabels: args.optOutLabels }) });
  const outcomes = [
    ...superseded.outcomes,
    ...(await performBumpActs({ args, bots, deps, home: args.home, scheduled })),
  ];
  const notes = note === undefined ? superseded.notes : [note, ...superseded.notes];
  writeBumpDriveReport({ args, deps, notes, openCount: read.value.rows.length, outcomes, repos: read.value.repos });
  return EXIT_OK;
}

/**
 * Whether GitHub resolves every repository the read returned no row for, naming each one it does not.
 *
 * Every candidate is asked, so one run names every bad slug rather than the first. A read that proves nothing
 * either way stops the pass too: its zero would be just as unverified.
 *
 * @param repos the repositories the pass read
 * @param rows the rows the read returned
 * @returns true when the pass may go on
 */
async function allRepositoriesResolve({
  deps,
  home,
  repos,
  rows,
}: {
  deps: GithubBumpDriveDeps;
  home: string | undefined;
  repos: readonly string[];
  rows: readonly { readonly repoSlug: string }[];
}): Promise<boolean> {
  const lines = await repositoryResolutionRefusalLines({
    home,
    repos,
    resolveRepository: deps.resolveRepository,
    rowRepos: rows.map((row) => row.repoSlug),
    verb: "github bump-drive",
  });
  for (const line of lines) {
    deps.writeDiagnostic(line);
  }
  return lines.length === 0;
}

/** Print one pass's report, as the `--json` document or as the lines a reader scans. */
function writeBumpDriveReport({
  args,
  deps,
  notes,
  openCount,
  outcomes,
  repos,
}: {
  args: { dryRun: boolean; json: boolean };
  deps: GithubBumpDriveDeps;
  notes: Parameters<typeof bumpDriveLines>[0]["notes"];
  openCount: number;
  outcomes: Parameters<typeof bumpDriveLines>[0]["outcomes"];
  repos: Parameters<typeof bumpDriveDocument>[0]["repos"];
}): void {
  if (args.json) {
    deps.writeOut(
      safeJsonStringify({
        label: "github bump-drive document",
        value: bumpDriveDocument({
          dryRun: args.dryRun,
          notes,
          nowIso: deps.now().toISOString(),
          openCount,
          outcomes,
          repos,
        }),
      }),
    );
    return;
  }
  for (const line of bumpDriveLines({ notes, openCount, outcomes })) {
    deps.writeOut(line);
  }
}

/**
 * The environment one description rewrite's child call sees.
 *
 * It ADDS to the two hatches and can never close one, which is what `hatch-release` requires and why this is
 * not a parameter default: a name in {@link BUMP_REWRITE_HATCHES} reads open here whatever the ambient value
 * is, and every other name is passed straight through to the real environment. The act is bounded instead by
 * the criterion that selected it — a bot's bump whose only failing check is `dev-gate` — and every outcome
 * line names both hatches, so an opened one is never silent.
 *
 * @param ambient the underlying environment reader, so a test never needs `process.env`
 * @returns the reader `github pr update` is given for that one call
 */
function rewriteEnv({ ambient }: { ambient: GithubPrDeps["env"] }): GithubPrDeps["env"] {
  return ({ name }) => {
    if (BUMP_REWRITE_HATCHES.includes(name)) {
      return "1";
    }
    return ambient({ name });
  };
}

/**
 * Production edges: the landing read's own, plus `github ready`, `github pr update` and the ledger read.
 *
 * @returns the read, press, board, ledger, undraft, rewrite, clock and output seams
 */
export function productionGithubBumpDriveDeps(): GithubBumpDriveDeps {
  const readyDeps = productionGithubReadyDeps();
  const prDeps = productionGithubPrDeps();
  return {
    ...productionGithubLandingDeps(),
    ...productionBumpCloseDeps(),
    rewriteBody: ({ argv, quiet }) =>
      runGithubPr({
        argv,
        deps: {
          ...prDeps,
          env: rewriteEnv({ ambient: prDeps.env }),
          out: quiet
            ? ({ line }) => {
                logger.warn({ msg: line });
              }
            : prDeps.out,
        },
      }),
    markReady: ({ rest, quiet }) =>
      runGithubReady({
        deps: quiet
          ? {
              ...readyDeps,
              out: (line) => {
                logger.warn({ msg: line });
              },
            }
          : readyDeps,
        rest,
      }),
    askUnrootable: bumpAskUnrootable,
    resolveRepository: ({ repoSlug, home }) =>
      resolveGithubRepository({
        graphql: githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }),
        repoSlug,
      }),
  };
}

/**
 * Whether `handover register`'s unrooted-path gate would refuse one seat's full `--ask`.
 *
 * The same two roots `../handover/registerPreWrite.ts` hands the gate — the declared checkout, else where the
 * verb runs; the given home, else the resolved one — so this answers what the register itself would.
 *
 * @param ask the ask exactly as the register would receive it
 * @param home the state home the row would be written under, absent for the resolved one
 * @param checkout the checkout the row would declare as its `--repo`
 * @returns true when the gate would refuse the ask
 */
export function bumpAskUnrootable({
  ask,
  home,
  checkout,
}: {
  ask: string;
  home: string | undefined;
  checkout: string | undefined;
}): boolean {
  let repoRoot = process.cwd();
  if (checkout !== undefined) {
    repoRoot = checkout;
  }
  const refusal = unrootedBriefPathRefusal({
    command: "slopweaver handover register",
    env: process.env,
    ...(home === undefined ? {} : { home }),
    repoRoot,
    text: ask,
  });
  return refusal !== undefined;
}

/** `slopweaver github bump-drive`. */
export const githubBumpDriveCommand = defineCommand({
  run: (argv) => runGithubBumpDrive({ deps: productionGithubBumpDriveDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
