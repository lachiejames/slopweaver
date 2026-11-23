/**
 * One landing row and its reader, which refuses the row whole when a field the page's claim rests on is missing. A
 * sibling of `./readLanding.ts`, under every rule its module doc states.
 */

import { type Bag, bool, num, str, strings, sub } from "../../lib/bag";
import { humanWaitOf, type LandingWait } from "./readHumanWait";
import {
  askTrailOf,
  bumpOf,
  channelShareOf,
  type LandingAsk,
  type LandingBump,
  type LandingShare,
} from "./readLandingAsks";
import {
  boardRowSlugOf,
  checksOf,
  ciFailureOf,
  type LandingCheck,
  type LandingCiFailure,
  type LandingTest,
  type LandingThreads,
  type LandingWaiting,
  testsOf,
  threadsOf,
  waitingOf,
} from "./readLandingFields";

/**
 * One open pull request as `github landing --json` published it: the one next act and every fact it
 * rests on. Nothing here is re-derived; the page chooses what to SHOW and never what is TRUE.
 */
export interface LandingRow {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repoSlug: string;
  /** Who opened it — the verb's own field, so a bump bot's row is told from a session's without the title. */
  readonly authorLogin: string;
  readonly labels: readonly string[];
  /** The `undrafted` test read `fail`: the row is a draft. Not a field the verb prints, so it is named here. */
  readonly draft: boolean;
  readonly createdAtIso: string;
  /** Who is waiting on us and on how many threads — the verb's `openThreads`, by login. */
  readonly waitingOn: readonly LandingWaiting[];
  readonly headOid: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  /** The one next act, the verb's own word: `press`, `conflicting`, `draft`, `unknown`, and so on. */
  readonly action: string;
  readonly actionDetail: string;
  readonly ci: string;
  /**
   * What a red rollup is red on. A document from before the verb classified it reads `required: undefined` on
   * red — unknown, never advisory — and `not-red` otherwise.
   */
  readonly ciFailure: LandingCiFailure;
  /** The dispatch verdict the supervisor acts on, absent when the row is not dispatchable. */
  readonly verdict: string | undefined;
  /**
   * The dispatch decision's kind, `src/review/landingDispatch.ts`'s `act`/`waiting`/`outside-the-set`/`unread`, absent
   * when the row is not dispatchable. `unread` means a fact a terminal claim would rest on was not read.
   */
  readonly dispatchKind: string | undefined;
  readonly dispatchWhy: string | undefined;
  readonly blockedOn: readonly string[];
  /** Whether a handover board row declares this branch, and the verb's sentence about it. */
  readonly boardRowKind: string;
  readonly boardRowWhy: string | undefined;
  /**
   * The slug of the board row that declares this branch, on a `row` join — what an act card joins its
   * ledger row's `run` against. `undefined` on every other join kind, which names no row.
   */
  readonly boardRowSlug: string | undefined;
  readonly tests: readonly LandingTest[];
  readonly failingChecks: readonly LandingCheck[];
  readonly humans: LandingThreads;
  readonly codeRabbit: LandingThreads;
  readonly stacked: boolean;
  readonly stackPosition: number | undefined;
  readonly stackSize: number | undefined;
  readonly slackAsked: string;
  readonly slackWhy: string | undefined;
  /**
   * Every certified ask on this pull request, newest first. `undefined` when the document predates the field —
   * which is not "nobody was asked", and the page says so rather than drawing an empty trail.
   */
  readonly askTrail: readonly LandingAsk[] | undefined;
  /** Shared with a channel, nobody named — `undefined` when it does not apply or the document predates it. */
  readonly channelShare: LandingShare | undefined;
  /** Whether the Slack window could carry an absence at all — the verb's `slack.bounded`, when it printed one. */
  readonly slackBounded: boolean | undefined;
  /** Whether to ask again, when the document carries the verdict. */
  readonly bump: LandingBump | undefined;
  readonly updatedAtIso: string;
  /** On a `blocked-on` row, who it waits on, since when, the last nudge, whether stale, and the next act. */
  readonly humanWait: LandingWait | undefined;
}

/**
 * One landing row, refused whole when a field the page's claim rests on is missing.
 *
 * @returns the row, or `undefined`
 */
export function landingRowOf({ row }: { row: Bag }): LandingRow | undefined {
  const number = num({ bag: row, key: "number" });
  const title = str({ bag: row, key: "title" });
  const url = str({ bag: row, key: "url" });
  const repoSlug = str({ bag: row, key: "repoSlug" });
  const headOid = str({ bag: row, key: "headOid" });
  const headRefName = str({ bag: row, key: "headRefName" });
  const baseRefName = str({ bag: row, key: "baseRefName" });
  const action = str({ bag: row, key: "action" });
  const actionDetail = str({ bag: row, key: "actionDetail" });
  const ci = str({ bag: row, key: "ci" });
  const blockedOn = strings({ bag: row, key: "blockedOn" });
  const boardRow = sub({ bag: row, key: "boardRow" });
  const conversations = sub({ bag: row, key: "conversations" });
  const stack = sub({ bag: row, key: "stack" });
  const slack = sub({ bag: row, key: "slack" });
  const updatedAtIso = str({ bag: row, key: "updatedAtIso" });
  const authorLogin = str({ bag: row, key: "authorLogin" });
  const labels = strings({ bag: row, key: "labels" });
  const createdAtIso = str({ bag: row, key: "createdAtIso" });
  const waitingOn = waitingOf({ row });
  const tests = testsOf({ row });
  const failingChecks = checksOf({ row });
  if (
    authorLogin === undefined ||
    labels === undefined ||
    createdAtIso === undefined ||
    waitingOn === undefined ||
    number === undefined ||
    title === undefined ||
    url === undefined ||
    repoSlug === undefined ||
    repoSlug.trim() === "" ||
    headOid === undefined ||
    headRefName === undefined ||
    baseRefName === undefined ||
    action === undefined ||
    actionDetail === undefined ||
    ci === undefined ||
    blockedOn === undefined ||
    boardRow === undefined ||
    conversations === undefined ||
    stack === undefined ||
    slack === undefined ||
    updatedAtIso === undefined ||
    tests === undefined ||
    failingChecks === undefined
  ) {
    return undefined;
  }
  const boardRowKind = str({ bag: boardRow, key: "kind" });
  const boardRowSlug = boardRowSlugOf({ boardRow });
  const humans = threadsOf({ bag: conversations, key: "humans" });
  const codeRabbit = threadsOf({ bag: conversations, key: "codeRabbit" });
  const stacked = stack["stacked"];
  const slackAsked = str({ bag: slack, key: "asked" });
  if (
    boardRowKind === undefined ||
    boardRowSlug === null ||
    humans === undefined ||
    codeRabbit === undefined ||
    typeof stacked !== "boolean" ||
    slackAsked === undefined
  ) {
    return undefined;
  }
  // `dispatch` is genuinely absent on a row the verb does not dispatch (a draft, an unknown), so its two
  // fields are carried as the absence they are rather than refusing the row.
  const dispatch = sub({ bag: row, key: "dispatch" });
  let verdict: string | undefined;
  let dispatchKind: string | undefined;
  let dispatchWhy: string | undefined;
  if (dispatch !== undefined) {
    verdict = str({ bag: dispatch, key: "verdict" });
    dispatchKind = str({ bag: dispatch, key: "kind" });
    dispatchWhy = str({ bag: dispatch, key: "why" });
  }
  const humanWait = humanWaitOf({ row });
  const askTrail = askTrailOf({ row });
  const channelShare = channelShareOf({ row });
  const bump = bumpOf({ row });
  const slackBounded = slack["bounded"];
  const badBounded = slackBounded !== undefined && typeof slackBounded !== "boolean";
  const ciFailure = ciFailureOf({ ci, row });
  if (
    humanWait === null ||
    askTrail === null ||
    channelShare === null ||
    bump === null ||
    badBounded ||
    ciFailure === null
  ) {
    return undefined;
  }
  const undrafted = tests.find((test) => test.id === "undrafted");
  const draft = undrafted?.verdict === "fail";
  return {
    action,
    actionDetail,
    askTrail,
    authorLogin,
    baseRefName,
    blockedOn,
    boardRowKind,
    boardRowSlug,
    channelShare,
    createdAtIso,
    draft,
    boardRowWhy: str({ bag: boardRow, key: "why" }),
    bump,
    ci,
    ciFailure,
    codeRabbit,
    dispatchKind,
    dispatchWhy,
    failingChecks,
    headOid,
    headRefName,
    humans,
    humanWait,
    labels,
    number,
    repoSlug,
    slackAsked,
    slackBounded: bool({ bag: slack, key: "bounded" }),
    slackWhy: str({ bag: slack, key: "why" }),
    stackPosition: num({ bag: stack, key: "position" }),
    stackSize: num({ bag: stack, key: "size" }),
    stacked,
    tests,
    title,
    updatedAtIso,
    url,
    verdict,
    waitingOn,
  };
}
