/**
 * Both landing verbs' last step before their mutation: resolve the author's own open walkthrough threads.
 *
 * `github enqueue` runs it immediately before its door, and `github merge --admin` immediately before its own,
 * so a pull request of the owner's never lands with a self-review note still open whichever door it goes through. The
 * criterion, the measurement that moved it BEFORE the queue entry
 * and the owner's ruling are in `../../../review/walkthroughClearance.ts`.
 *
 * ## Where it sits
 *
 * Resolving and then being refused would leave a pull request unlanded with its reviewer wayfinding collapsed.
 * So it runs after every one of the verb's own findings has cleared and after the pairing floor's re-read, and
 * it refuses BEFORE resolving anything when the read's head is not the head the landing is pinned to — a push
 * in between would otherwise have it resolve the new head's notes and then be refused on the old one.
 *
 * ## What each failure does
 *
 * - **A thread read fails, or carries only a first page** — the first read or the confirming one: the landing
 *   is NOT made, on either door, unless the `unseen-review-threads` hatch is open. An unseen thread may be a
 *   colleague's reply collapsed under a resolve, which no conversation rule catches, since GitHub reads it as
 *   resolved.
 * - **A thread the landing resolved now holds somebody else's last word**: resolved, the step REOPENS it and
 *   does not land; open, it does not land until the owner answers it. Either way the refusal prints the reply and the
 *   command answering it. An open thread of the owner's own holding
 *   a colleague's unanswered reply holds the landing too, remembered or not. Which resolves were the landing's
 *   own is the walkthrough-thread register's (`../../../outbound/github/walkthroughLedger.ts`), written
 *   BEFORE each resolve is sent, because GitHub records the fleet's resolve and the owner's own under the same login.
 * - **A thread cannot be addressed, the register cannot be read or written, or a resolve fails**: the landing
 *   is NOT made. What did resolve is still recorded, and a thread a re-read shows still open is recorded
 *   `released`, so the owner's own later resolve of it is never mistaken for the landing's.
 * - **The re-read after the resolves finds one open again or gained a reply**: the landing is NOT made.
 *   GitHub's resolve takes a node id and no precondition, so a colleague's reply arriving between the first
 *   read and the resolve is resolved with it; the step reopens it at once, and the next run's guard reopens it
 *   if that could not happen now. The re-read is the step's final read, so the whole reply guard runs over it
 *   again, catching a reply that arrived mid-step on any other thread.
 *
 * Residue, stated: a reply arriving after the re-read and before the mutation is not seen here. On the queue
 * door GitHub refuses an entry an open conversation holds; on the admin door it depends on the base's rules.
 * A reopen whose `surfaced` row is then lost reads as the landing's resolve once more, so a resolve the owner makes
 * afterwards is reopened one extra time before the row is written.
 */

import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import type { Result } from "../../../lib/result.js";
import type { PrReviewThread } from "../../../live/github/reviewState.js";
import type { WalkthroughAct } from "../../../outbound/github/walkthroughLedger.js";
import {
  type LandingThreadMemory,
  type WalkthroughClearance,
  walkthroughAutonomyRow,
  walkthroughClearance,
  walkthroughRecheck,
} from "../../../review/walkthroughClearance.js";
import { EXIT_OK } from "../../exitCodes.js";
import {
  ANSWER_EACH,
  releaseUntaken,
  reopenClause,
  repliesSettled,
  type StepRun,
  threadArgv,
  writeAnswers,
} from "./walkthroughReplies.js";

/** What the thread read answers: whose pull request it is, who is pressing, its head, and every thread. */
export interface WalkthroughRead {
  readonly authorLogin: string;
  readonly viewerLogin: string;
  /** The head the threads were read at. */
  readonly headOid: string;
  readonly threads: readonly PrReviewThread[];
  /** Whether GitHub had more threads than the read carried. */
  readonly truncated: boolean;
}

/** The edges the step reads, resolves, reopens and records through. */
export interface WalkthroughStepDeps {
  /** Read the pull request's author, the token's own login, its head, and every review thread. */
  readonly walkthroughs: (args: {
    home: string;
    owner: string;
    repo: string;
    number: number;
  }) => Promise<Result<WalkthroughRead>>;
  /** Resolve ONE thread through `github thread resolve`; argv after the verb words. Returns its exit code. */
  readonly resolveThread: (args: { rest: readonly string[] }) => Promise<number>;
  /** Reopen ONE thread through `github thread reopen`; argv after the verb words. Returns its exit code. */
  readonly reopenThread: (args: { rest: readonly string[] }) => Promise<number>;
  /** What the walkthrough-thread register holds for one pull request, `repo` as `owner/name`. */
  readonly threadMemory: (args: { home: string; repo: string; number: number }) => Result<LandingThreadMemory>;
  /** Record what the landing did to each thread, `repo` as `owner/name`. Returns the sentence saying it could not. */
  readonly rememberThreads: (args: {
    home: string;
    repo: string;
    number: number;
    acts: readonly WalkthroughAct[];
  }) => string | undefined;
  /** Append one act to the autonomy ledger. Returns the sentence saying it could not, or undefined. */
  readonly recordAutonomy: (args: { home: string; row: AutonomyActionRow }) => Promise<string | undefined>;
  /** Whether the `unseen-review-threads` hatch is open, letting a failed or partial thread read land. */
  readonly unseenThreadsAllowed: () => boolean;
  /** What identifies this session on a ledger row. */
  readonly sessionRef: () => string;
  readonly now: () => Date;
}

/** The pull request about to land, as the landing verb's own read found it. */
export interface WalkthroughTarget {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly headOid: string;
  readonly url: string;
}

/**
 * Resolve every thread the clearance selected and ledger the act.
 *
 * @param threadIds the node ids to resolve
 * @returns the node ids that resolved
 */
async function resolveAndRecord({ run, threadIds }: { run: StepRun; threadIds: readonly string[] }): Promise<string[]> {
  const resolved: string[] = [];
  for (const threadId of threadIds) {
    if ((await run.deps.resolveThread({ rest: threadArgv({ run, threadId }) })) === EXIT_OK) {
      resolved.push(threadId);
    }
  }
  if (resolved.length === 0) {
    return resolved;
  }
  const row = walkthroughAutonomyRow({
    bySession: run.deps.sessionRef(),
    doneIso: run.deps.now().toISOString(),
    headOid: run.target.headOid,
    number: run.target.number,
    repoSlug: `${run.target.owner}/${run.target.repo}`,
    selected: threadIds.length,
    threadIds: resolved,
    url: run.target.url,
    verb: run.verb,
  });
  const unledgered = row.isErr()
    ? row.error.message
    : await run.deps.recordAutonomy({ home: run.home, row: row.value });
  if (unledgered !== undefined) {
    run.write(`the autonomy ledger row for the resolve could not be written (${unledgered})`);
  }
  return resolved;
}

/**
 * Re-read the threads the step just resolved; reopen any that gained a reply, and answer whether to land.
 *
 * @param threadIds the node ids the step resolved
 * @param before every thread the read that selected them carried
 * @returns whether the landing may go ahead
 */
async function confirmResolved({
  run,
  threadIds,
  before,
}: {
  run: StepRun;
  threadIds: readonly string[];
  before: readonly PrReviewThread[];
}): Promise<boolean> {
  const { deps, target, home, write } = run;
  const selected = String(threadIds.length);
  const reread = await deps.walkthroughs({ home, number: target.number, owner: target.owner, repo: target.repo });
  if (reread.isErr()) {
    write(
      `not landed: resolved our own ${selected} open walkthrough thread(s), but the re-read confirming them ` +
        `failed (${reread.error.join("; ")}); run it again`,
    );
    return false;
  }
  if (reread.value.truncated) {
    const why = `resolved our own ${selected} open walkthrough thread(s), but the re-read confirming them carried only GitHub's first page of threads`;
    if (!deps.unseenThreadsAllowed()) {
      write(hatchRefusal({ detail: why, hatch: hatchFor({ id: "unseen-review-threads" }) }));
      return false;
    }
    write(`note: ${why}; only those were checked, as the unseen-review-threads hatch is open`);
  }
  const recheck = walkthroughRecheck({ before, threadIds, threads: reread.value.threads });
  if (recheck.replied.length > 0) {
    const replied = reread.value.threads.filter((thread) => recheck.replied.includes(thread.id));
    write(
      `not landed: ${String(recheck.replied.length)} of the ${selected} walkthrough thread(s) just resolved carries ` +
        `a reply that arrived as they were read; ${await reopenClause({ run, threads: replied })}. ${ANSWER_EACH}`,
    );
    writeAnswers({ run, threads: replied });
    return false;
  }
  if (recheck.open.length > 0) {
    const lost = releaseUntaken({ run, threadIds: recheck.open, threads: reread.value.threads });
    write(
      `not landed: ${String(recheck.open.length)} of the ${selected} walkthrough thread(s) just resolved is ` +
        `open again, or missing from the re-read; GitHub refuses the landing while a conversation is open${lost}`,
    );
    return false;
  }
  // The re-read is the step's final read, so the reply guard runs over it too: a reply arriving mid-step under
  // a resolve an EARLIER landing made is not among the threads just resolved.
  if (!(await repliesSettled({ dryRun: false, read: reread.value, run }))) {
    return false;
  }
  write(`resolved our own ${selected} open walkthrough thread(s) before landing`);
  return true;
}

/**
 * Whether the read may be acted on at all: it succeeded, is at the landing's head, and carried every thread —
 * the last two waived only by the `unseen-review-threads` hatch.
 *
 * @param read the thread read
 * @param dryRun whether the lines say "would not land"
 * @returns the read when it may be acted on, or whether the landing may go ahead without it
 */
function usableRead({
  run,
  read,
  dryRun,
}: {
  run: StepRun;
  read: Result<WalkthroughRead>;
  dryRun: boolean;
}): WalkthroughRead | boolean {
  const allowed = run.deps.unseenThreadsAllowed();
  const refuse = ({ detail }: { detail: string }): false => {
    run.write(hatchRefusal({ detail, hatch: hatchFor({ id: "unseen-review-threads" }) }));
    return false;
  };
  if (read.isErr()) {
    const why = `the review threads could not be read (${read.error.join("; ")})`;
    if (!allowed) {
      return refuse({ detail: why });
    }
    run.write(`note: ${why}; landing anyway, as the unseen-review-threads hatch is open`);
    return true;
  }
  if (read.value.headOid.toLowerCase() !== run.target.headOid.toLowerCase()) {
    run.write(
      `${dryRun ? "would not land" : "not landed"}: the head moved to ${read.value.headOid.slice(0, 7)} since the ` +
        `landing read ${run.target.headOid.slice(0, 7)}; nothing was resolved, run it again`,
    );
    return false;
  }
  if (read.value.truncated && !allowed) {
    return refuse({ detail: "GitHub had more review threads than this read carried" });
  }
  if (read.value.truncated) {
    run.write(
      "note: GitHub had more review threads than this read carried; only those were considered, as the hatch is open",
    );
  }
  return read.value;
}

/**
 * What the clearance says before anything is resolved: the thread ids to resolve, or whether the landing may go
 * ahead with none resolved.
 *
 * @param clearance the selection off the usable read
 * @param stopped the refusal's opening words, "would not land" under a dry run
 * @returns the thread ids to resolve, or the landing's verdict when there are none to take
 */
function clearanceTargets({
  run,
  clearance,
  stopped,
}: {
  run: StepRun;
  clearance: WalkthroughClearance;
  stopped: string;
}): readonly string[] | boolean {
  switch (clearance.kind) {
    case "none":
      return true;
    case "not-ours":
      run.write(
        `left ${String(clearance.open)} of @${clearance.authorLogin}'s own open walkthrough thread(s) as they ` +
          "are: the pull request is not this account's",
      );
      return true;
    case "unaddressable":
      run.write(
        `${stopped}: ${String(clearance.unaddressable)} of our own ${String(clearance.open)} open walkthrough ` +
          "thread(s) came back with no node id, so none can be resolved here and GitHub refuses the landing " +
          "while a conversation is open; resolve them on the pull request",
      );
      return false;
    case "clear":
      return clearance.threadIds;
    default: {
      const unhandled: never = clearance;
      return unhandled;
    }
  }
}

/**
 * Record the selected threads in the register, resolve them, and confirm on a re-read that none took a reply.
 *
 * @param threadIds the author's own open walkthrough threads the clearance selected
 * @param before the read that selected them, whose comment counts tell a raced reply apart
 * @returns whether the landing may go ahead
 */
async function resolveSelected({
  run,
  threadIds,
  before,
}: {
  run: StepRun;
  threadIds: readonly string[];
  before: WalkthroughRead["threads"];
}): Promise<boolean> {
  const { deps, home, target } = run;
  const selected = threadIds.length;
  const unremembered = deps.rememberThreads({
    acts: threadIds.map((threadId) => ({ kind: "resolving", threadId })),
    home,
    number: target.number,
    repo: `${target.owner}/${target.repo}`,
  });
  if (unremembered !== undefined) {
    run.write(
      `not landed: the walkthrough-thread register could not record the ${String(selected)} thread(s) about to ` +
        `be resolved (${unremembered}), and a resolve it does not remember cannot be told from the owner's own; nothing was resolved`,
    );
    return false;
  }
  const resolved = await resolveAndRecord({ run, threadIds });
  if (resolved.length < selected) {
    const failed = threadIds.filter((threadId) => !resolved.includes(threadId));
    const after = await deps.walkthroughs({ home, number: target.number, owner: target.owner, repo: target.repo });
    const lost = releaseUntaken({ run, threadIds: failed, threads: after.isOk() ? after.value.threads : undefined });
    run.write(
      `not landed: resolved ${String(resolved.length)} of our own ${String(selected)} open walkthrough thread(s), ` +
        `and ${String(failed.length)} could not be resolved; GitHub refuses the landing while a ` +
        `conversation is open, so resolve them with \`slopweaver github thread resolve\` and run it again${lost}`,
    );
    return false;
  }
  return confirmResolved({ before, run, threadIds: resolved });
}

/**
 * Resolve the author's own open walkthrough threads, or under `dryRun` say that the landing would.
 *
 * @param target the pull request about to land
 * @param home the state home whose door records each resolve and whose ledger records the act
 * @param dryRun whether to say what would happen and write nothing
 * @param verb the landing verb, as its witness and its lines name it
 * @param write where every line goes: the verb's DIAGNOSTIC channel, so a `--json` document stays one object
 * @param deps the injected edges
 * @returns whether the landing may go ahead
 */
export async function clearWalkthroughsBeforeLanding({
  target,
  home,
  dryRun,
  verb,
  write,
  deps,
}: {
  target: WalkthroughTarget;
  home: string;
  dryRun: boolean;
  verb: string;
  write: (line: string) => void;
  deps: WalkthroughStepDeps;
}): Promise<boolean> {
  const run: StepRun = { deps, home, target, verb, write };
  const read = await deps.walkthroughs({ home, number: target.number, owner: target.owner, repo: target.repo });
  const usable = usableRead({ dryRun, read, run });
  if (typeof usable === "boolean") {
    return usable;
  }
  if (!(await repliesSettled({ dryRun, read: usable, run }))) {
    return false;
  }
  const stopped = dryRun ? "would not land" : "not landed";
  const threadIds = clearanceTargets({ clearance: walkthroughClearance(usable), run, stopped });
  if (typeof threadIds === "boolean") {
    return threadIds;
  }
  if (dryRun) {
    write(`would first resolve ${String(threadIds.length)} of our own open walkthrough thread(s)`);
    return true;
  }
  return resolveSelected({ before: usable.threads, run, threadIds });
}
