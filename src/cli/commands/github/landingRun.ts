/**
 * The effectful shell for `slopweaver github landing`.
 *
 * ## What it reads, and what it deliberately does not
 *
 * One fleet read through `collectReviewStates` — the same seam `github review-state` and session-start use,
 * so there is exactly one place that decides what a pull request's state is.
 *
 * **ONE Slack leg is off here, not both.**
 * `collectReviewStates` runs the corpus mention scan for the whole fleet unconditionally, and `slackLive`
 * gates only the LIVE per-pull-request search — so a boot read has always carried `slack.asked` and the bump
 * verdict, bounded by the corpus watermark. `--slack-live` turns the live half on per invocation. What it
 * buys, MEASURED over the same 30 pull requests in the same minute with the corpus 10 hours behind: corpus
 * alone answered `asked: yes` on 15 and `bump: due` on 1; with the live leg, 27 and 9. Reproduce by running
 * `slopweaver github review-state --repo acme/acme-admin --author <login> --json` once with
 * `--no-slack-live` and once without, and tallying `[.pullRequests[].slack.asked]` and
 * `[.pullRequests[].bump.kind]` from each. It stays OFF by default because it costs one Slack search PER
 * PULL REQUEST, against the rest of this read's branch-bounded shape.
 *
 * ## The cadence, which is what lets a sweep run this every tick
 *
 * Owner ruling: the read must not cut into rate limits, so every fresh supervisor handover fetches all the open
 * pull requests once, as a boot step. A SENTENCE in three skill files rations nothing, it only stops the read: a
 * chair's whole shift can go by without one while a pull request sits evicted from the merge queue and
 * conflicted for days.
 *
 * `--if-due` makes the ration a mechanism instead: the sweep runs this verb every tick, and a tick whose
 * cadence has not elapsed exits 0 having made NO GitHub request at all
 * (`../../../review/readJournal.ts`). The rate-limit concern is answered by construction rather than by memory.
 *
 * ## The registration
 *
 * `--register` writes one board row per dispatchable row, so the sweep's own fill step seats it against
 * measured capacity. There is deliberately no flag here that spawns; `./landingRegister.ts` says why, and
 * why a `merge-now` row is enqueued rather than seated. It also SETTLES the `ready` rows whose pull request has
 * since merged or closed, the merge commit as witness (`./landingClosureRun.ts`) — the read sees only open pull
 * requests, so nothing else ever takes one off the board.
 *
 * Beyond the fleet read it makes two kinds of call bounded by BRANCHES rather than by pull requests: whether
 * each distinct base branch has a merge queue, and what each requires. Both loop once per distinct
 * REPOSITORY-AND-BRANCH key, so twenty-nine open pull requests across two repositories sharing two base
 * branches cost **two keys x two loops**, not fifty-eight-per-loop — and in production the required-context
 * leg is itself a GraphQL read plus a REST read (`../../../live/github/mergeQueue.ts`), so the transport
 * count is six rather than four. The point that survives is the SHAPE: bounded by branches, never by pull
 * requests. An earlier draft of this header said "two calls" and counted neither loop; a Codex review
 * caught it. It also asks for ONE per-fleet comparison — how far each head is behind its base
 * (`../../../live/github/baseDistance.ts`) — which is one round trip and one rate-limit point for the whole
 * fleet, and one bounded re-read of whatever mergeability GitHub had not computed
 * (`../../../live/github/mergeableRecheck.ts`).
 *
 * ## The dispatch verdict
 *
 * Every row also carries the ONE thing the supervisor DOES about it, from a closed set. Every verdict but the
 * owner's-judgment one is dispatched to a spawned session on the supervisor's own judgment, and that one alone
 * is carded HIGH on react-now — `--json`'s `dispatchable` array is every dispatched verdict, selected once so
 * no consumer re-derives which rows are carded.
 * `../../../review/landingDispatch.ts` carries the ladder and the terminal evidence gate.
 *
 * ## The press
 *
 * Its production EDGES live in `./landingDeps.ts` — every credential read, local-state write and provider
 * seam — so what stays here is the part that decides something.
 *
 * `--press` lives in `./landingPress.ts`, which owns the only write this verb makes to GitHub and the two
 * windows it re-reads before making it.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import {
  type LandingRow,
  landingRow,
  landingTally,
  type QueueAvailability,
  type RecordedPress,
} from "../../../review/landing.js";
import type { LandingBoardRow } from "../../../review/landingBoard.js";
import { type ReadCadence, selectionKey } from "../../../review/readJournal.js";
import type { ReviewRoster } from "../../../review/reviewRoster.js";
import type { PrReviewState } from "../../../review/reviewState.js";
import type { SlackCoverage } from "../../../review/slackEvidenceTypes.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { cadenceFor, recordCadence } from "./landingCadence.js";
import { performRegisterWrites } from "./landingClosureRun.js";
import { performPressWrites } from "./landingCodeRabbitNudge.js";
import {
  fleetReadArgs,
  type GithubLandingArgs,
  githubLandingUsage,
  organisationRefusalLine,
  parseGithubLandingArgs,
  resolveRepos,
} from "./landingCore.js";
import type { GithubLandingDeps } from "./landingDepsContract.js";
import { reportLandingDetail } from "./landingDetail.js";
import { endedLandingPr } from "./landingEnded.js";
import { queueAvailabilityOf, readQueues } from "./landingQueues.js";
import { recordReadingOf } from "./landingReadingRecord.js";
import { boardJoin } from "./landingRegister.js";
import {
  askPeopleOf,
  everyLoginSlackIdOf,
  type LandingDocument,
  type LandingSkippedDocument,
  landingDocument,
  loginSlackIdsOf,
} from "./landingReport.js";
import { reportLanding } from "./landingTerminal.js";
import { collectReviewStates } from "./reviewStateRun.js";

const VERB_ARG_OFFSET = 4;

export type { GithubLandingDeps } from "./landingDepsContract.js";

/** Every row this read produced, in the order the fleet returned them. */
function buildRows({
  authoredByOwner,
  states,
  queues,
  boardRowOf,
  presses,
  optOutLabels,
  nowIso,
}: {
  authoredByOwner: boolean;
  nowIso: string;
  states: readonly PrReviewState[];
  queues: ReadonlyMap<string, QueueAvailability>;
  boardRowOf: (head: PrReviewState) => LandingBoardRow;
  presses: ReadonlyMap<string, RecordedPress>;
  optOutLabels: readonly string[];
}): readonly LandingRow[] {
  return states.map((state) =>
    landingRow({
      inputs: {
        authoredByOwner,
        boardRow: boardRowOf(state),
        nowIso,
        optOutLabels,
        press: presses.get(`${state.repoSlug}#${String(state.number)}`),
        queueAvailability: queueAvailabilityOf({ queues, state }),
        state,
      },
    }),
  );
}

/**
 * One fleet read, broken into landing rows — the whole read half of this verb, with no write in it.
 *
 * Exported so a SECOND question over the same rows does not mean a second fleet read path. `github
 * bottleneck` groups these rows by cause rather than acting on them one at a time
 * (`../../../review/bottleneck.ts`), and a copy of the collect-then-build sequence would be the place the
 * two answers drifted apart.
 *
 * @param args the parsed invocation, whose `repos` must already be resolved
 * @param deps the injected edges
 * @param repos the repository slugs to read
 * @returns the rows in the order the fleet returned them, what the read could reach, and the roster it
 *   resolved names through — the document's `people` are read off it rather than a second roster load
 */
export async function readLandingRows({
  args,
  deps,
  repos,
}: {
  args: GithubLandingArgs;
  deps: GithubLandingDeps;
  repos: readonly string[];
}): Promise<
  Result<{ readonly rows: readonly LandingRow[]; readonly coverage: SlackCoverage; readonly roster: ReviewRoster }>
> {
  // Read BEFORE any GitHub request: a press register that cannot be read refuses the pass, because a row judged
  // with no press record would offer to press again what this machine already pressed.
  const presses = await deps.presses({ home: args.home });
  if (presses.isErr()) {
    return err([presses.error.message]);
  }
  // No resolution verb: an unreadable repository is the census's `unread` entry, never a refusal of the whole read.
  const read = await collectReviewStates({
    args: fleetReadArgs({ args, repos }),
    deps: deps.reviewState,
    repositoryResolutionVerb: undefined,
  });
  if (read.isErr()) {
    return err(read.error);
  }
  const { states, coverage, roster } = read.value;
  return ok({ coverage, roster, rows: await rowsOver({ args, deps, presses: presses.value, states }) });
}

/**
 * What the run itself could not see, as distinct from what one row could not.
 *
 * The SLACK coverage lines are folded in here, and their absence was a real hole: `--slack-live` needs a
 * Slack user token, production returns no search seam when there is none, and nothing printed said so — so
 * the flag could silently do nothing and every row's ask answer would read exactly as it does without it.
 * `collectReviewStates` has always produced that line; this verb simply never printed it. A Codex review
 * found it.
 *
 * @param rows every row this read produced
 * @param slackResidue what the Slack legs reported about their own reach
 * @returns the lines to print once, deduplicated
 */
function runResidue({
  rows,
  slackResidue,
}: {
  rows: readonly LandingRow[];
  slackResidue: readonly string[];
}): readonly string[] {
  const lines = new Set<string>();
  for (const row of rows) {
    for (const line of row.residue) {
      lines.add(line);
    }
  }
  for (const line of slackResidue) {
    lines.add(line);
  }
  lines.add(
    "the board join is a handover row's declared `branch:` or the branch its run recorded at `handover start`, " +
      "so a `none?` cell means no row STATED this branch rather than that no row exists",
  );
  return [...lines];
}

/**
 * Resolve the repositories and read every open pull request in one step — the whole prologue a BACKLOG verb
 * needs before it has anything to judge.
 *
 * It exists because `github bottleneck` and `github bump-drive` opened with a byte-identical copy of the two
 * calls plus their two diagnostic loops, and the clone gate named the pair (reproduce with
 * `slopweaver dev lint --only duplicate-windows`). Both failures are forwarded as plain messages rather than
 * written here, so one caller still owns its own reporting.
 *
 * @param args the landing-shaped arguments the calling verb mapped its own onto
 * @param deps the landing read seams
 * @returns the rows, the Slack coverage and the repositories the read covered
 */
export async function resolveAndReadLandingRows({
  args,
  deps,
}: {
  args: GithubLandingArgs;
  deps: GithubLandingDeps;
}): Promise<
  Result<{
    readonly rows: readonly LandingRow[];
    readonly coverage: SlackCoverage;
    readonly repos: readonly string[];
  }>
> {
  const repos = await resolveRepos({ args, deps });
  if (repos.isErr()) {
    return err([organisationRefusalLine({ error: repos.error })]);
  }
  const read = await readLandingRows({ args, deps, repos: repos.value });
  if (read.isErr()) {
    return err(read.error);
  }
  return ok({ coverage: read.value.coverage, repos: repos.value, rows: read.value.rows });
}

/**
 * Run one `github landing` invocation against injected edges.
 *
 * @param rest argv after `github landing`
 * @param deps the review-state, queue, board, register, press, clock and output seams
 * @returns the process exit code
 */
export async function runGithubLanding({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubLandingDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "github", rest, verb: "landing" });
  if (gated !== undefined) {
    return gated;
  }
  const parsed = parseGithubLandingArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(githubLandingUsage());
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const repos = await resolveRepos({ args, deps });
  if (repos.isErr()) {
    deps.writeDiagnostic(organisationRefusalLine({ error: repos.error }));
    return EXIT_ERROR;
  }
  const selection = selectionKey({ author: args.author, draftsOnly: args.draftsOnly, repos: repos.value });
  const { cadenceMinutes, home, ifDue } = args;
  const judged = await cadenceFor({ cadenceMinutes, deps, home, ifDue, selection });
  if (judged.isErr()) {
    deps.writeDiagnostic(`github landing: --if-due refused — ${judged.error}`);
    return EXIT_ERROR;
  }
  const cadence = judged.value;
  if (cadence.kind === "skip") {
    reportSkipped({ args, cadence, deps, selection });
    return EXIT_OK;
  }
  const ended = await endedLandingPr({ deps, home, number: args.pr, slug: repos.value[0]! });
  if (ended !== undefined) {
    return ended;
  }
  const read = await readLandingRows({ args, deps, repos: repos.value });
  if (read.isErr()) {
    for (const problem of read.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const { rows, coverage, roster } = read.value;
  if (args.pr !== undefined) {
    return reportLandingDetail({ deps, home: args.home, number: args.pr, rows, slug: repos.value[0]! });
  }
  const logins = loginSlackIdsOf({ rows, slackIdForLogin: roster.slackIdForLogin });
  const people = askPeopleOf({ logins, nameForSlackId: roster.nameForSlackId, rows });
  const loginSlackIds = everyLoginSlackIdOf({ rows, slackIdsForLogin: roster.slackIdsForLogin });
  const document = await writesOver({ args, coverage, deps, loginSlackIds, logins, people, repos: repos.value, rows });
  reportLanding({ args, cadence, deps, document });
  recordReadingOf({ args, deps, document });
  return recordCadence({ deps, dispatchable: document.dispatchable.length, home, rows: rows.length, selection });
}

/**
 * Every row this read produced, with the three local reads a row is judged against.
 *
 * @param states the fleet read's own answer
 * @param args the parsed invocation
 * @param deps the injected edges
 * @param presses the press register, already read
 * @returns the rows, in the order the fleet returned them
 */
async function rowsOver({
  states,
  args,
  deps,
  presses,
}: {
  states: readonly PrReviewState[];
  args: GithubLandingArgs;
  deps: GithubLandingDeps;
  presses: ReadonlyMap<string, RecordedPress>;
}): Promise<readonly LandingRow[]> {
  return buildRows({
    authoredByOwner: args.authoredByOwner,
    boardRowOf: boardJoin({ deps, home: args.home }),
    nowIso: deps.now().toISOString(),
    optOutLabels: args.optOutLabels,
    presses,
    queues: await readQueues({ home: args.home, queueFor: deps.queueFor, states }),
    states,
  });
}

/**
 * Every write this verb can make, in the order that keeps them consistent: re-request a stuck CodeRabbit
 * review and press, then register what those left behind.
 *
 * The document is built between them because `--register` is handed the SAME `dispatchable` array the
 * document reports, which already excludes anything this run pressed or re-requested. Deriving it twice is
 * how one output ends up both reporting a press and listing that row as work to send somebody.
 *
 * @param rows every row this read produced
 * @param args the parsed invocation
 * @param coverage what the fleet read could reach
 * @param deps the injected edges
 * @param repos the resolved repository slugs, recorded on the document as its selection
 * @param people the names the roster holds for the ask trails' recipients
 * @param logins the Slack ids the roster holds for authors and named code owners
 * @param loginSlackIds every Slack id the roster holds for the same logins
 * @returns the document, with every write outcome on it
 */
async function writesOver({
  rows,
  args,
  coverage,
  deps,
  repos,
  people,
  logins,
  loginSlackIds,
}: {
  rows: readonly LandingRow[];
  args: GithubLandingArgs;
  coverage: { readonly residue: readonly string[] };
  deps: GithubLandingDeps;
  repos: readonly string[];
  people: Readonly<Record<string, { readonly name: string }>>;
  logins: Readonly<Record<string, string>>;
  loginSlackIds: Readonly<Record<string, readonly string[]>>;
}): Promise<LandingDocument> {
  const presses = args.press ? await performPressWrites({ args, deps, rows }) : [];
  const document = landingDocument({
    census: await deps.openCensus({ home: args.home, repos }),
    loginSlackIds,
    logins,
    people,
    presses,
    residue: runResidue({ rows, slackResidue: coverage.residue }),
    rows,
    selection: { author: args.author, includeDrafts: args.includeDrafts, repos },
    tally: landingTally({ rows }),
  });
  if (!args.register) {
    return document;
  }
  const { dryRun, home, json: quiet } = args;
  return { ...document, ...(await performRegisterWrites({ deps, document, dryRun, home, quiet, repos })) };
}

/** The one line, or the one document, a tick that made no GitHub request prints. */
function reportSkipped({
  cadence,
  selection,
  args,
  deps,
}: {
  cadence: Extract<ReadCadence, { kind: "skip" }>;
  selection: string;
  args: GithubLandingArgs;
  deps: GithubLandingDeps;
}): void {
  const document: LandingSkippedDocument = {
    cadenceMinutes: args.cadenceMinutes,
    kind: "skipped",
    lastReadAtIso: cadence.lastReadAtIso,
    nextDueAtIso: cadence.nextDueAtIso,
    selection,
    why: cadence.why,
  };
  if (args.json) {
    deps.writeOut(safeJsonStringify({ label: "github landing document", value: document }));
    return;
  }
  deps.writeOut(`landing: not due — ${cadence.why}. Next due ${cadence.nextDueAtIso}`);
}

import { productionGithubLandingDeps } from "./landingDeps.js";

export { productionGithubLandingDeps } from "./landingDeps.js";

/** `slopweaver github landing`. */
export const githubLandingCommand = defineCommand({
  run: (argv) => runGithubLanding({ deps: productionGithubLandingDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
