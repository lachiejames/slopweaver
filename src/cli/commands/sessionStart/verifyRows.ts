/**
 * The live re-read `session-start` performs BEFORE it ranks: the things this verb ASSERTS and the corpus
 * alone cannot establish, read back through the door.
 *
 * ## It is the default, because an opt-in flag plus a caveat fails
 *
 * An opt-in `--verify` flag, alongside a caveat printed on every run saying a row's state was whatever its
 * source last recorded, fails on both halves together. Measured on a ten-row list, six rows were wrong and
 * three described work that was already finished: one pull request had merged the previous day through the
 * queue with 21 checks passed while its row said it could not merge, one was closed while its row asked the
 * owner to rule on it, and one had merged after an earlier sweep called it ready. Stale rows take up the space
 * of what would have been useful information.
 *
 * **A warning printed on every run is not a mitigation** — it is noise the reader learns to skip. This
 * pass is the default. An opt-out (`--no-verify`) survives for a fast local run; the default is honest.
 *
 * ## What it checks
 *
 * - **A close proposal's ticket may already be closed.** The owner ruled on seven of them through the
 *   cycle-hygiene card twenty minutes before the list told the owner to rule on them again. The cycle pass reads
 *   Linear bronze, which lags, so the proposals survive their own subject.
 * - **A row's pull-request references may have LANDED, or may belong to a dead repository.** The first is
 *   the failure above; the second is {@link ../../../sessionStart/staleRefs} in full.
 *
 * Every effect is injected ({@link VerifySeams}), so each rule here is testable with a plain fake rather
 * than a provider. {@link productionVerifySeams} is the one place the real doors are wired.
 *
 * Bounded exactly as {@link ../cycle/verify} is, and for the same reason: this runs in a morning verb, so it
 * reads only what the list is about to show the owner, never a search and never a crawl.
 */

import { linearToken } from "../../../config.js";
import { isRecord } from "../../../lib/parsers.js";
import { type PullRequestLiveState, readPullRequestState } from "../../../live/github/pullRequestState.js";
import { linearReadRequest, readLinearObject } from "../../../live/linear/read.js";
import type { Organisation } from "../../../organisation/core.js";
import { beforeDeadline, type RunDeadline } from "../../../sessionStart/deadline.js";
import type { Item } from "../../../sessionStart/item.js";
import type { RankInput } from "../../../sessionStart/rank.js";
import {
  bareRefs,
  type RefResolution,
  repoSlugFor,
  settledRefsReason,
  staleRefReason,
} from "../../../sessionStart/staleRefs.js";
import {
  type CodeOwnerSliceSeam,
  readSliceLive,
  readViewerLive,
  unreadLinksNote,
  type ViewerLoginRead,
  withCodeOwnerSlice,
} from "./verifySlice.js";

/**
 * How many live reads one verify pass may make, across both checks.
 *
 * A daily list is not a backfill. Past this the pass stops and says what it did not reach, which is the
 * honest failure — the alternative is a morning verb that fans out over a corpus that has drifted.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const VERIFY_ROW_MAX = 40;

/** Linear state types that mean the ticket is no longer live work. */
const SETTLED_STATE_TYPES = new Set(["completed", "canceled"]);

/**
 * The two live reads a verify pass makes, injected so every rule above them is testable without a provider.
 *
 * @internal the contract between this leg and {@link productionVerifySeams}.
 */
export interface VerifySeams {
  /** The live state of one pull request in one repository. */
  readonly pullRequestState: (args: { repo: string; number: number }) => Promise<PullRequestLiveState>;
  /** One Linear issue's live workflow-state TYPE, or undefined when it could not be read. */
  readonly linearStateType: (args: { identifier: string }) => Promise<string | undefined>;
  /** The GitHub login the token belongs to — the owner's — asked at most once per pass, one request. */
  readonly viewerLogin: () => Promise<ViewerLoginRead>;
  /** The owner's code-owner slice of one pull request, spending at most `maxReads` reads and saying how many it did. */
  readonly codeOwnerSlice: CodeOwnerSliceSeam;
}

/**
 * What one verify pass did, so the verb can say it rather than imply it.
 *
 * @internal the contract between this leg and the verb's own shell.
 */
export interface RowVerification {
  /** The candidates that survived, with any that went stale marked unverified and told why. */
  readonly inputs: readonly RankInput[];
  /**
   * The item each of {@link inputs} was read FROM, at the same index. A code-owner slice replaces a row's item
   * object, so {@link applyLiveVerification} finds a row by where it came from rather than by what it became.
   */
  readonly origins: readonly Item[];
  /** Identities dropped because their subject is already settled, with the state that settled them. */
  readonly settledLive: readonly string[];
  /** What the pass could not reach or could not resolve, stated rather than omitted. */
  readonly couldNotSee: readonly string[];
  readonly reads: number;
  /**
   * Whether the run's `--deadline` stopped the pass before every row was reached. A row read before the cut keeps
   * what its live read found — one settled is dropped, exactly as a whole pass drops it — and only the rows not
   * reached carry the corpus's own state.
   */
  readonly cutShort: boolean;
}

/** The `couldNotSee` line a pass the run's deadline stopped carries. */
export const VERIFY_CUT_SHORT_LINE =
  "the live check stopped at this run's --deadline, so later rows carry the corpus's own state";

/**
 * The live state type of one Linear issue, or undefined when it could not be read.
 *
 * @param identifier the issue's own key
 * @param home the state home whose stored Linear token authenticates the read
 * @returns the workflow state's type, or undefined when nothing was established
 */
async function liveStateType({ identifier, home }: { identifier: string; home: string }): Promise<string | undefined> {
  const key = linearToken({ home });
  if (key === undefined) {
    return undefined;
  }
  const read = await readLinearObject({
    address: identifier,
    limit: 1,
    nowIso: () => new Date().toISOString(),
    request: linearReadRequest({ token: key }),
  });
  if (read.isErr() || !isRecord(read.value.data)) {
    return undefined;
  }
  const state = read.value.data["state"];
  return isRecord(state) && typeof state["type"] === "string" ? state["type"] : undefined;
}

/**
 * The real doors, wired once, every credential read from the run's own state home.
 *
 * @param home the state home the run was given, so `session-start --home B` verifies as B's accounts
 * @returns the seams a production run verifies through
 */
export function productionVerifySeams({ home }: { home: string }): VerifySeams {
  return {
    codeOwnerSlice: async (args) => readSliceLive({ ...args, home }),
    linearStateType: async ({ identifier }) => liveStateType({ home, identifier }),
    pullRequestState: async ({ number, repo }) =>
      readPullRequestState({ home, number, repo, subject: "issue-or-pull-request" }),
    viewerLogin: async () => readViewerLive({ home }),
  };
}

/**
 * The owner's login, read through one request asked lazily and at most once a pass — a failure included, so a refused
 * token is not asked again for every row.
 *
 * @param seams the live reads, whose `viewerLogin` is asked
 * @returns a reader costing one read the first time and none after
 */
function viewerLoginOnce({ seams }: { seams: VerifySeams }): () => Promise<{ read: ViewerLoginRead; cost: number }> {
  let viewer: Promise<ViewerLoginRead> | undefined;
  return async () => {
    if (viewer !== undefined) {
      return { cost: 0, read: await viewer };
    }
    viewer = seams.viewerLogin();
    return { cost: 1, read: await viewer };
  };
}

/**
 * Re-read what the list is about to assert.
 *
 * A read that cannot happen at all — no credential, a provider that refuses — leaves the row exactly as the
 * corpus had it and adds a line to `couldNotSee`. It never marks a row verified it did not check, and it
 * never drops a row it could not read: an unread row is unknown, and unknown is not settled.
 *
 * @param inputs every candidate both legs produced
 * @param seams the live reads to verify through
 * @param organisation the organisation whose repositories name the checkout a row's bare PR number belongs to
 * @param deadline the run's `--deadline`; the row it arrives during, and every later one, is kept unread exactly as
 *   past {@link VERIFY_ROW_MAX}. Absent: the pass reads until its bound
 * @returns what survived, what was already settled, and what the pass could not reach
 */
export async function verifyRows({
  inputs,
  organisation,
  seams,
  deadline,
}: {
  inputs: readonly RankInput[];
  organisation: Organisation;
  seams: VerifySeams;
  deadline?: RunDeadline;
}): Promise<RowVerification> {
  const kept: RankInput[] = [];
  const origins: Item[] = [];
  const settledLive: string[] = [];
  const couldNotSee: string[] = [];
  let reads = 0;
  let cutShort = false;
  const viewerOnce = viewerLoginOnce({ seams });

  for (const input of inputs) {
    const checked = await checkRowUnlessCut({
      budget: VERIFY_ROW_MAX - reads,
      cutShort,
      deadline,
      input,
      organisation,
      seams,
      viewerOnce,
    });
    cutShort = checked.cut;
    const { check } = checked;
    reads += check.reads;
    if (check.kept !== undefined) {
      kept.push(check.kept);
      origins.push(input.item);
    }
    if (check.settled !== undefined) {
      settledLive.push(check.settled);
    }
    if (check.note !== undefined) {
      couldNotSee.push(check.note);
    }
  }

  if (reads >= VERIFY_ROW_MAX) {
    couldNotSee.push(
      `the live check stopped at its bound of ${String(VERIFY_ROW_MAX)} reads, so later rows carry the corpus's own state`,
    );
  }
  if (cutShort) {
    couldNotSee.push(VERIFY_CUT_SHORT_LINE);
  }
  return { couldNotSee, cutShort, inputs: kept, origins, reads, settledLive };
}

/**
 * Replace each row with what the live re-read found, dropping the ones it could no longer see.
 *
 * A no-op when the pass did not run, which is the `--no-verify` case: with nothing re-read live there is
 * nothing to replace, and every row stands as its source last recorded it.
 *
 * @param resolved every row after the owner's standing resolutions were applied
 * @param verified what the live re-read found, absent when it did not run
 * @returns the rows to rank
 */
export function applyLiveVerification<T extends { readonly input: RankInput }>({
  resolved,
  verified,
}: {
  resolved: readonly T[];
  verified: Pick<RowVerification, "inputs" | "origins"> | undefined;
}): readonly T[] {
  if (verified === undefined) {
    return resolved;
  }
  return resolved.flatMap((one) => {
    const live = verified.inputs[verified.origins.indexOf(one.input.item)];
    // A row the re-read could no longer see leaves the list; one it found is replaced by what it found.
    if (live === undefined) {
      return [];
    }
    return [{ ...one, input: live }];
  });
}

/** What one row's live check decided. `kept` absent means the row leaves the list. */
interface RowCheck {
  readonly kept?: RankInput;
  /** Set when the row's subject turned out to be already settled where it lives. */
  readonly settled?: string;
  /** A line for the run's `could not see`, when the check found or could not reach something. */
  readonly note?: string;
  readonly reads: number;
}

/**
 * One row's live check, raced against the run's deadline when it has one.
 *
 * A row past the read bound, or reached after the pass was already cut, is kept unread; so is the row the
 * deadline arrives during, like every one after it.
 *
 * @param budget how many reads remain in this pass
 * @param cutShort whether an earlier row already met the deadline
 * @param deadline the run's `--deadline`, absent when it was given none
 * @returns the row's check, and whether the pass is now cut short
 */
async function checkRowUnlessCut({
  budget,
  cutShort,
  deadline,
  input,
  organisation,
  seams,
  viewerOnce,
}: {
  budget: number;
  cutShort: boolean;
  deadline: RunDeadline | undefined;
  input: RankInput;
  organisation: Organisation;
  seams: VerifySeams;
  viewerOnce: () => Promise<{ read: ViewerLoginRead; cost: number }>;
}): Promise<{ check: RowCheck; cut: boolean }> {
  const unread: RowCheck = { kept: input, reads: 0 };
  if (budget <= 0 || cutShort) {
    return { check: unread, cut: cutShort };
  }
  const check = async (): Promise<RowCheck> =>
    isCloseProposal({ input })
      ? checkTicketStillOpen({ input, seams })
      : checkRefsResolve({ budget, input, organisation, seams, viewerOnce });
  if (deadline === undefined) {
    return { check: await check(), cut: false };
  }
  const raced = await beforeDeadline({ deadline, work: check });
  if (raced.kind === "cut") {
    return { check: unread, cut: true };
  }
  return { check: raced.value, cut: false };
}

/** Whether a row is a cycle close proposal, which is the one kind whose subject can settle underneath it. */
function isCloseProposal({ input }: { input: RankInput }): boolean {
  return input.item.source === "linear" && input.trace.verdict === "propose-close";
}

/**
 * Whether a close proposal's ticket is still open.
 *
 * A ticket that has settled since the corpus last saw it leaves the list entirely: proposing that the owner close
 * something the owner closed twenty minutes ago is the exact friction this whole verb exists to remove.
 *
 * @param input the close proposal
 * @param seams the live reads to verify through
 * @returns the row's fate, and the one read it cost
 */
async function checkTicketStillOpen({ input, seams }: { input: RankInput; seams: VerifySeams }): Promise<RowCheck> {
  const type = await seams.linearStateType({ identifier: input.item.nativeId });
  if (type === undefined) {
    return {
      kept: { ...input, unverified: true },
      note: `${input.item.nativeId} could not be re-read live, so its state here is the corpus's copy`,
      reads: 1,
    };
  }
  if (SETTLED_STATE_TYPES.has(type)) {
    return { reads: 1, settled: `${input.item.nativeId} is already "${type}" in Linear` };
  }
  return { kept: { ...input, unverified: false }, reads: 1 };
}

/**
 * The verdict one live pull-request state carries into {@link ../../../sessionStart/staleRefs}.
 *
 * @param live what the provider said about the number
 * @returns the reference's verdict
 */
export function refVerdict({ live }: { live: PullRequestLiveState }): RefResolution["verdict"] {
  switch (live.kind) {
    case "absent":
      return "unknown-to-canonical";
    case "notChecked":
      return "not-checked";
    case "open":
      return "resolved";
    case "settled":
      return "settled";
    default: {
      const exhaustive: never = live;
      return exhaustive;
    }
  }
}

/**
 * One live reference read, as the resolution the pure reasons are built from.
 *
 * @param number the referenced pull request
 * @param live what the provider said about it
 * @returns the resolution, carrying the provider's own state word when there was one
 */
export function refResolution({ number, live }: { number: number; live: PullRequestLiveState }): RefResolution {
  const verdict = refVerdict({ live });
  return live.kind === "settled" ? { number, state: live.state, verdict } : { number, verdict };
}

/**
 * Whether a row's pull-request references are still live in the canonical repository.
 *
 * Two different fates, and the order matters. A row with an UNRESOLVABLE reference is KEPT and marked
 * unverified rather than dropped — the number being wrong does not mean the work is done, it means the row
 * was written somewhere else, and the owner still has to decide what to do about it. A row whose references have
 * every one of them MERGED or CLOSED is held back entirely: its subject finished, so putting it in front of
 * the owner costs the space of a row that has not.
 *
 * A kept Slack ask naming one open pull request then gains the owner's code-owner slice (`./verifySlice.ts`).
 *
 * @param input the row, whose own `repo` decides which repository its references belong to
 * @param budget how many reads remain in this pass
 * @param seams the live reads to verify through
 * @param viewerOnce the owner's login, read at most once a pass, with what this call of it cost
 * @param organisation the organisation whose repositories a checkout path is named against
 * @returns the row's fate, and the reads it cost
 */
async function checkRefsResolve({
  input,
  budget,
  organisation,
  seams,
  viewerOnce,
}: {
  input: RankInput;
  budget: number;
  organisation: Organisation;
  seams: VerifySeams;
  viewerOnce: () => Promise<{ read: ViewerLoginRead; cost: number }>;
}): Promise<RowCheck> {
  const canonicalRepo = repoSlugFor({ organisation, repoPath: input.item.repo });
  const refs = bareRefs({ text: input.item.doneWhen }).slice(0, budget);
  if (canonicalRepo === undefined || refs.length === 0) {
    const note = unreadLinksNote({ input });
    return note === undefined ? { kept: input, reads: 0 } : { kept: input, note, reads: 0 };
  }
  const resolutions: RefResolution[] = [];
  for (const number of refs) {
    const live = await seams.pullRequestState({ number, repo: canonicalRepo });
    resolutions.push(refResolution({ live, number }));
  }
  const stale = staleRefReason({ repo: canonicalRepo, resolutions });
  if (stale !== undefined) {
    return { kept: { ...input, unverified: true }, note: `${input.item.nativeId}: ${stale}`, reads: refs.length };
  }
  const settled = settledRefsReason({ repo: canonicalRepo, resolutions });
  if (settled !== undefined) {
    return { reads: refs.length, settled: `${input.item.nativeId}: ${settled}` };
  }
  // A row whose references were all UNCHECKABLE is not a row that passed. Saying nothing here is how the
  // previous revision hid its own broken check, so the absence of an answer gets a line of its own.
  if (resolutions.every((one) => one.verdict === "not-checked")) {
    return {
      kept: input,
      note: `${input.item.nativeId}: none of its ${String(refs.length)} pull-request reference(s) could be checked against ${canonicalRepo}`,
      reads: refs.length,
    };
  }
  if (input.item.source !== "slack") {
    return { kept: input, reads: refs.length };
  }
  const sliced = await withCodeOwnerSlice({
    budget: budget - refs.length,
    input,
    repo: canonicalRepo,
    readSlice: seams.codeOwnerSlice,
    resolutions,
    viewerOnce,
  });
  return { ...sliced, reads: refs.length + sliced.reads };
}
