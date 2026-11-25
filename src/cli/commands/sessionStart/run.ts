/**
 * `slopweaver session-start` — the ranked list of what is actually tasked to the owner.
 *
 * The friction it removes: instead of reading every Slack message, every mail and every connected app to
 * work out what the owner must do, something that has already read them hands the owner an ordered list,
 * so the important work all gets done.
 *
 * A thin effectful shell. Every rule is pure — {@link ../../../sessionStart/boardLeg} detects,
 * {@link ../../../silver/ruleZero} and {@link ../../../silver/traceBeforeRanking} gate,
 * {@link ../../../sessionStart/rank} orders, {@link ../../../sessionStart/render} prints — and the clock
 * enters exactly once, here.
 *
 * **No model runs in it**, the same shape as `store read`. The ranking is rules the owner can read, argue with and
 * overrule; a model would make every row unanswerable.
 *
 * **It writes nothing and posts nothing.** It reads, ranks and asks. Every action a row suggests is a verb
 * the owner chooses, taken through the existing door with its existing gates.
 *
 * **It RE-READS before it ranks.** Every row goes back to its own provider through the door before it is
 * scored — {@link ./verifyRows} carries what that costs and why it stopped being a flag — and the board leg
 * additionally asks whether the session that recorded a question still exists, because a dead session's
 * question is a question nobody is waiting on. `--no-verify` opts out for a fast local run and says so on
 * the output.
 *
 * ALL FIVE LEGS ARE WIRED. The board leg reads the runs stopped on the owner; the cycle leg consumes
 * `slopweaver cycle reconcile` and is the only one that can measure drift; the Slack leg scans bronze for
 * both shapes of unanswered — a thread the owner spoke in that moved on without the owner, and a thread the owner has never
 * spoken in where somebody tagged the owner; the Gmail leg pairs two LIVE listings, because the corpus
 * carries no `INBOX` or `UNREAD` label at all; the GitHub leg reads the owner's open pull requests through
 * `github review-state` and places each by whose move it is. Meeting transcripts remain a DECLARED gap,
 * printed on every run rather than implied away.
 *
 * A leg that cannot run does not take the list down with it. The cycle pass needs Linear bronze, a
 * structures lane and an identity map, and a home missing any of them still gets its board rows plus the
 * typed reason the other leg is absent.
 *
 * **It also says what MOVED.** Each run records the set it showed and the next one diffs against it, which
 * is the owner's third ask: a day later, conversations and meetings have shifted things, and the list should notice
 * without the owner telling it. `gone` deliberately never reads as `done` —
 * {@link ../../../sessionStart/reconcile} has the reason, and it is the failure that made V1 untrustworthy.
 *
 * **What the owner said last time is the LAST gate, not a signal.** The lock-in ledger is applied after both legs
 * and after the ranking's own gates, because a verdict the owner gave is not a weight another row's score can
 * outvote. A held resolution keeps its item off the list and says so in the drop reason, and it lapses the
 * moment the item moves — see {@link ../../../sessionStart/lockIn}.
 *
 * **And every row says where it already STANDS.** After the ranking, each row is judged against the open
 * runs on the board, the live session ledger and the lock-in ledger, and carries a `standing` — `ruled`,
 * `in-flight` or `untouched` — into `--json` and onto the terminal. A row a session is inside is held back
 * with the reason; a row the owner already ruled on is demoted below every untouched one and labelled with the
 * ruling's date. A STACKED row is suppressed earlier and by a different test — `../../../review/stack`
 * against the repository's default branch — so it is not a standing at all. The first few items on the list must never be
 * things the owner already answered in a previous supervisor chat —
 * {@link ../../../sessionStart/standing} carries the incident.
 */

import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { readOrganisation } from "../../../organisation/read.js";
import { boardLeg } from "../../../sessionStart/boardLeg.js";
import { beforeDeadline, type RunDeadline, wallClockDeadline } from "../../../sessionStart/deadline.js";
import { inFlightRuns } from "../../../sessionStart/inFlightRuns.js";
import {
  applyResolutions,
  foldLockInLedger,
  type LockInState,
  parseLockInRows,
  type Resolved,
  readLockInLedger,
} from "../../../sessionStart/lockIn.js";
import { type DroppedItem, type RankInput, type Ranking, rankAll } from "../../../sessionStart/rank.js";
import { applyStandings, type Standing, standingsOf } from "../../../sessionStart/standing.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import {
  parseSessionStartArgs,
  SESSION_START_USAGE,
  SESSION_START_VERBS,
  type SessionStartOptions,
  sessionStartOptions,
} from "./core.js";
import type { AssembledList } from "./emit.js";
import { jsonDocument, printList, standingTally } from "./emit.js";
import { type SessionStartError, sessionStartErrorLines } from "./errors.js";
import { readLiveLegs } from "./liveLegs.js";
import { type BoardRead, readWaitingOnOwner } from "./read.js";
import { reconcileUnlessCut } from "./reconcileStep.js";
import { readSlackThreads } from "./slackRead.js";
import { unverifiedPastDeadline, unverifiedWithoutOrganisation, verifyCutParts } from "./unverifiedPass.js";
import { applyLiveVerification, productionVerifySeams, type RowVerification, verifyRows } from "./verifyRows.js";

/**
 * What this verb cannot see yet, printed on every run rather than left for the owner to discover.
 *
 * These are facts about which legs are wired, not caveats about the code. A list that implied it had read
 * the owner's Slack and the owner's mail while reading neither is the one failure that would cost the owner trust in it outright.
 *
 * A caveat that a board row's question is the one recorded when the run stopped, not re-read live against the
 * world it asks about, has no place here: it would be printed on every run, including one that shipped three finished rows, and read past every time.
 * **A caveat on every run is not a mitigation**; the behaviour it would apologise for is the default
 * (see {@link ./verifyRows}), so the sentence would not merely be noisy, it would be false.
 */
const COULD_NOT_SEE: readonly string[] = [
  "the handover board, your Linear cycle, your Slack threads, your mail and your open pull requests are read here; a source none of those five covers is not on this list",
  "a meeting transcript is not read at all: huddles are indexed with their participants and times, but the words spoken in them are not retrievable here",
];

/**
 * What a `--no-verify` run cannot stand behind.
 *
 * All three name a defect the owner actually hit rather than a theoretical gap, and all three were rows that were
 * true when written and false when read. They are printed ONLY when the owner opted out of the live re-read,
 * because a verified run has checked every one of them.
 */
const UNVERIFIED_LIMITS: readonly string[] = [
  "you passed --no-verify, so nothing below was re-read live — every state here is whatever its source last recorded",
  "a CLOSE row's ticket may already be closed, and a row's pull request may already have merged: three rows on one list were finished work, found this way",
  "a row's bare PR number is not resolved against the repository its own doc names, and some board journals were written when this project lived in a different one",
];

/**
 * Read the verb's own arguments, printing whatever it refused.
 *
 * Separate from the run so the shell below is the reads and the ranking rather than argv handling, and so
 * both refusal paths put the usage line out exactly once.
 *
 * @param rest argv after the noun and verb
 * @returns the options, or undefined when they were refused and the reason has already been printed
 */
function readOptions({ rest }: { rest: readonly string[] }): SessionStartOptions | undefined {
  const parsed = parseSessionStartArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: SESSION_START_USAGE });
    return undefined;
  }
  const options = sessionStartOptions({ parsed: parsed.value });
  if (options.isErr()) {
    sessionStartErrorLines({ error: options.error }).forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: SESSION_START_USAGE });
    return undefined;
  }
  return options.value;
}

/**
 * Where every row already stands, judged against the board's open runs, the live session ledger and the
 * lock-in ledger — AFTER the ranking and the live re-read, so a ruling is judged against the instant the
 * row actually carries.
 *
 * @param board the board read, carrying every doc's journal and holder
 * @param home the state home holding the session ledger
 * @param nowIso the run's own instant
 * @param ranking what the ranker produced
 * @param states the folded lock-in ledger
 * @returns one standing per item identity
 */
function standingsFor({
  board,
  home,
  nowIso,
  ranking,
  states,
}: {
  board: BoardRead;
  home: string;
  nowIso: string;
  ranking: Ranking;
  states: ReadonlyMap<string, LockInState>;
}): ReadonlyMap<string, Standing> {
  return standingsOf({
    items: [...ranking.ranked, ...ranking.dropped].map((row) => row.item),
    nowIso,
    runs: inFlightRuns({
      board: board.runs,
      sessions: foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home }) }).events }),
    }),
    states,
  });
}

/**
 * The live verify pass, over the organisation the store holds — which names the repository a row's bare PR number
 * belongs to. One that will not read is {@link unverifiedWithoutOrganisation}.
 *
 * @param home the state home whose store holds the organisation
 * @param resolved every candidate the legs produced, after the owner's resolutions
 * @param deadline the run's `--deadline`, which the pass races row by row
 * @param verify whether the run re-reads live at all; `--no-verify` skips the pass
 * @returns the pass's verification, the unverified inputs and why, or undefined under `--no-verify`
 */
async function verifyIfAsked({
  deadline,
  home,
  resolved,
  verify,
}: {
  deadline: RunDeadline;
  home: string;
  resolved: readonly Resolved[];
  verify: boolean;
}): Promise<RowVerification | undefined> {
  if (!verify) {
    return undefined;
  }
  const inputs = resolved.map((one) => one.input);
  // The organisation lives in the store, whose query has no timeout of its own, so it is raced too.
  const raced = await beforeDeadline({ deadline, work: async () => readOrganisation({ home }) });
  if (raced.kind === "cut") {
    return unverifiedPastDeadline({ inputs });
  }
  const organisation = raced.value;
  if (organisation.isErr()) {
    return unverifiedWithoutOrganisation({ inputs, refusal: organisation.error.message });
  }
  return verifyRows({ deadline, inputs, organisation: organisation.value, seams: productionVerifySeams({ home }) });
}

/** The instant the list is judged at: `--now` as given, or — not given — the moment this run reads it. */
function judgedAt({ options }: { options: SessionStartOptions }): string {
  const { now } = options;
  if (now === undefined) {
    return new Date().toISOString();
  }
  return now;
}

/**
 * Read every leg, apply the owner's standing resolutions, rank what survives, judge each row's standing, and diff
 * against the last run.
 *
 * The whole effectful middle of the verb, in the order the pieces depend on each other. It lives apart from
 * the shell because the shell's job is now only to choose between two ways of printing the same thing, and a
 * new leg belongs here rather than in argv handling.
 *
 * @param options what the run was asked for
 * @returns everything the emitters need, or undefined when the board could not be read at all
 */
async function assembleList({ options }: { options: SessionStartOptions }): Promise<AssembledList | undefined> {
  const home = resolveHome({ named: options.home });
  const board = readBoard({ home, options });
  if (board === undefined) {
    return undefined;
  }
  const nowIso = judgedAt({ options });
  const { deadlineMs } = options;
  const deadline = wallClockDeadline({ deadlineMs });
  // The Slack scan is synchronous, so no timer fires inside it: it asks the deadline between chunks instead.
  const scanSlack = () => readSlackThreads({ home, nowIso, stopWhen: deadline.isReached });
  const legs = await readLiveLegs({ deadline, deadlineMs, home, nowIso, scanSlack, verify: options.verify });
  const { cycle, slack, mail, github } = legs;
  const states = foldLockInLedger({ rows: parseLockInRows({ text: readLockInLedger({ home }) }) });
  const inputs = [
    ...boardLeg({ entries: board.entries, nowIso }),
    ...cycle.inputs,
    ...slack.inputs,
    ...mail.inputs,
    ...(github.isOk() ? github.value.inputs : []),
  ];
  const resolved = applyResolutions({ inputs, nowIso, states });
  const verified = await verifyIfAsked({ deadline, home, resolved, verify: options.verify });
  deadline.release();
  const cut = [...legs.cut, ...verifyCutParts({ verified })];
  const scored = rankWhatSurvives({ resolved: applyLiveVerification({ resolved, verified }) });
  const ranking = applyStandings({
    ranking: scored.ranking,
    standings: standingsFor({ board, home, nowIso, ranking: scored.ranking, states }),
  });
  const { movements, sinceIso, couldNotSee } = reconcileUnlessCut({
    cut,
    home,
    nowIso,
    ranking,
    record: options.record,
  });
  return {
    couldNotSee: [...couldNotSeeLines({ cycle, github, mail, slack, verified }), ...couldNotSee],
    cutShort: cut,
    docsRead: board.docsRead,
    paused: board.paused,
    movements,
    nowIso,
    proposalsRead: cycle.proposalsRead,
    mailAnsweredAfterOwner: mail.answeredAfterOwner,
    mailRead: mail.inboxRead,
    pullRequestsRead: github.isOk() ? github.value.pullRequestsRead : 0,
    pullRequestsWaiting: github.isOk() ? github.value.waitingOnSomebodyElse : 0,
    slackThreadsRead: slack.threadsSpokenIn,
    slackThreadsMoved: slack.movedWithoutOwner,
    slackThreadsTagged: slack.taggedWithoutOwner,
    slackThreadsTagging: slack.threadsTagging,
    ranking,
    settledByLockIn: scored.settled.length,
    sinceIso,
    standingTally: standingTally({ ranking }),
  };
}

/**
 * Every limit this run carries, the legs' own included, in the order they are printed.
 *
 * @param cycle the cycle leg's read
 * @param slack the Slack leg's read
 * @param mail the mail leg's read
 * @param github the GitHub leg's read, or what stopped it
 * @param verified what the live re-read found, absent when it did not run
 * @returns one line per limit
 */
function couldNotSeeLines({
  cycle,
  slack,
  mail,
  github,
  verified,
}: {
  cycle: { readonly couldNotSee: readonly string[] };
  slack: { readonly couldNotSee: readonly string[] };
  mail: { readonly couldNotSee: readonly string[] };
  github: Result<{ readonly couldNotSee: readonly string[] }, SessionStartError>;
  verified: { readonly couldNotSee: readonly string[]; readonly settledLive: readonly string[] } | undefined;
}): readonly string[] {
  return [
    ...COULD_NOT_SEE,
    ...cycle.couldNotSee,
    ...slack.couldNotSee,
    ...mail.couldNotSee,
    ...(github.isOk() ? github.value.couldNotSee : sessionStartErrorLines({ error: github.error })),
    ...(verified === undefined ? UNVERIFIED_LIMITS : verified.couldNotSee),
    ...(verified === undefined
      ? []
      : verified.settledLive.map((one) => `held back, already settled where it lives: ${one}`)),
  ];
}

/**
 * Read the board slice, printing whatever stopped it.
 *
 * Separate from the run so the shell below is the ranking rather than error plumbing. The board is the one
 * read this verb cannot degrade around: with no register there is no list at all, which is a different fact
 * from a leg that could not run.
 *
 * @param home the state home
 * @param options what the run was asked for
 * @returns the slice, or undefined when it could not be read and the reason has already been printed
 */
function readBoard({ home, options }: { home: string; options: SessionStartOptions }): BoardRead | undefined {
  const board = readWaitingOnOwner({
    base: options.base,
    handoverDir: resolveHandoverDir({ dir: options.dir, home }),
    home,
    runCommands: options.probe,
  });
  if (board.isErr()) {
    board.error.forEach((error) => {
      logger.error({ msg: `session-start: ${error}` });
    });
    return undefined;
  }
  return board.value;
}

/**
 * Rank what a standing resolution did not hold back, and report the rest as settled.
 *
 * The held rows join the ranking's own drops rather than vanishing, because the drop count is what tells the owner
 * a leg found something and the list chose not to show it. A row silently absent is the failure the printed
 * count exists to prevent.
 *
 * @param resolved every candidate with the reason it was held back, or undefined when it stays
 * @returns the ranking, drops included, and the rows the owner's own words settled
 */
function rankWhatSurvives({ resolved }: { resolved: readonly Resolved[] }): {
  ranking: Ranking;
  settled: readonly DroppedItem[];
} {
  const kept: RankInput[] = [];
  const settled: DroppedItem[] = [];
  for (const one of resolved) {
    if (one.suppressedBecause === undefined) {
      kept.push(one.input);
      continue;
    }
    settled.push({ item: one.input.item, reason: one.suppressedBecause });
  }
  const scored = rankAll({ inputs: kept });
  return { ranking: { dropped: [...scored.dropped, ...settled], ranked: scored.ranked }, settled };
}

/**
 * Run the verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionStart(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: SESSION_START_VERBS });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SESSION_START_USAGE });
    return EXIT_OK;
  }
  const options = readOptions({ rest });
  if (options === undefined) {
    return EXIT_USAGE;
  }

  const assembled = await assembleList({ options });
  if (assembled === undefined) {
    return EXIT_ERROR;
  }
  if (options.json) {
    const document = JSON.stringify(jsonDocument(assembled), null, 2);
    if (options.out === undefined) {
      logger.out({ line: document });
      return EXIT_OK;
    }
    try {
      writeFileAtomic({ contents: `${document}\n`, path: options.out });
    } catch (cause: unknown) {
      logger.error({ msg: `session-start: could not write ${options.out}: ${String(cause)}` });
      return EXIT_ERROR;
    }
    // A receipt, not data: stderr, so stdout stays empty when the document went to a file.
    logger.info({ msg: `session-start: wrote ${options.out}` });
    return EXIT_OK;
  }
  printList({ ...assembled, top: options.top });
  return EXIT_OK;
}

export const sessionStartCommand = defineCommand({ run: runSessionStart });
