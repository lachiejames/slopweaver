/**
 * The walkthrough step's reply guard: a colleague's reply under a resolve the landing made is reopened, and an
 * open unanswered one holds the landing. The criterion is `../../../review/walkthroughClearance.ts`'s
 * `collapsedReplies` and `unansweredReplies`; why it needs the walkthrough-thread register is
 * `../../../outbound/github/walkthroughLedger.ts`'s overview.
 *
 * Its own module so `./walkthroughStep.ts` stays the sequence, and so the reopen path the confirming re-read
 * shares with the guard lives beside it.
 */

import { shellCommandLine } from "#lib/shellCommandLine.js";

import type { PrReviewThread } from "../../../live/github/reviewState.js";
import { collapsedReplies, unansweredReplies } from "../../../review/walkthroughClearance.js";
import { EXIT_OK } from "../../exitCodes.js";
import type { WalkthroughRead, WalkthroughStepDeps, WalkthroughTarget } from "./walkthroughStep.js";

/** Everything one run of the step carries, so each helper takes it whole. */
export interface StepRun {
  readonly target: WalkthroughTarget;
  readonly home: string;
  readonly verb: string;
  readonly write: (line: string) => void;
  readonly deps: WalkthroughStepDeps;
}

/**
 * The `github thread` argv tail addressing one thread on the target.
 *
 * @param run the step run whose pull request and home the argv names
 * @param threadId the node id
 * @returns the arguments after the sub-verb
 */
export function threadArgv({ run, threadId }: { run: StepRun; threadId: string }): readonly string[] {
  const repoSlug = `${run.target.owner}/${run.target.repo}`;
  return ["--repo", repoSlug, "--number", String(run.target.number), "--thread", threadId, "--home", run.home];
}

/**
 * The `github thread` command a refusal prints for one thread, over the same argv the landing's own resolve and
 * reopen take, quoted so it runs as printed whatever the home's path holds.
 *
 * @param run the step run whose pull request and home the command addresses
 * @param sub the `github thread` sub-verb
 * @param threadId the node id
 * @param extra the arguments after the thread's own
 * @returns the command line, in backticks
 */
function threadCommand({
  run,
  sub,
  threadId,
  extra,
}: {
  run: StepRun;
  sub: "reopen" | "reply";
  threadId: string;
  extra: readonly string[];
}): string {
  const command = ["slopweaver", "github", "thread", sub, ...threadArgv({ run, threadId }), ...extra];
  return `\`${shellCommandLine({ command })}\``;
}

/**
 * Reopen each thread, record the ones that reopened as surfaced, and say how that went as the tail of a
 * refusal line.
 *
 * @param run the step run the reopens go through
 * @param threads the threads to reopen, as the read that found each reply returned it
 * @returns the clause saying they are open again, or the exact command for each one that is not
 */
export async function reopenClause({
  run,
  threads,
}: {
  run: StepRun;
  threads: readonly PrReviewThread[];
}): Promise<string> {
  const failed: string[] = [];
  for (const thread of threads) {
    if ((await run.deps.reopenThread({ rest: threadArgv({ run, threadId: thread.id }) })) !== EXIT_OK) {
      failed.push(thread.id);
    }
  }
  const reopened = threads.filter((thread) => !failed.includes(thread.id));
  const lost = reopened.length === 0 ? "" : recordShown({ run, threads: reopened });
  if (failed.length === 0) {
    return `reopened, so the reply reads open again${lost}`;
  }
  const commands = failed.map((threadId) => threadCommand({ extra: [], run, sub: "reopen", threadId }));
  return `${String(failed.length)} could not be reopened, and the next landing reopens them first: ${commands.join("; ")}${lost}`;
}

/**
 * Record as `released` each thread GitHub shows OPEN after the landing set out to resolve it, so a resolve the owner
 * makes later is not read as the landing's. A thread missing from the read, or a read that failed, keeps its
 * `resolving` row: the resolve may have taken, and forgetting one that did is the unsafe direction.
 *
 * @param run the step run the register is written through
 * @param threadIds the node ids whose resolve did not go through as asked
 * @param threads the threads a read after those resolves returned, or undefined when that read failed
 * @returns the clause saying the register could not record the release, or an empty string
 */
export function releaseUntaken({
  run,
  threadIds,
  threads,
}: {
  run: StepRun;
  threadIds: readonly string[];
  threads: WalkthroughRead["threads"] | undefined;
}): string {
  if (threads === undefined) {
    return "";
  }
  const open = threads.filter((thread) => threadIds.includes(thread.id) && !thread.isResolved);
  if (open.length === 0) {
    return "";
  }
  const { target } = run;
  const unrecorded = run.deps.rememberThreads({
    acts: open.map((thread) => ({ kind: "released", threadId: thread.id })),
    home: run.home,
    number: target.number,
    repo: `${target.owner}/${target.repo}`,
  });
  return unrecorded === undefined ? "" : ` (the register could not record which resolves did not take: ${unrecorded})`;
}

/**
 * Whether every colleague's reply on a thread the landing resolved has been seen: a collapsed one is reopened,
 * an open unanswered one holds the landing.
 *
 * @param run the step run the guard reads the register and reopens through
 * @param read the usable thread read
 * @param dryRun whether to say what would happen and reopen nothing
 * @returns whether the landing may go on
 */
export async function repliesSettled({
  run,
  read,
  dryRun,
}: {
  run: StepRun;
  read: WalkthroughRead;
  dryRun: boolean;
}): Promise<boolean> {
  const { target, home, write } = run;
  const stopped = dryRun ? "would not land" : "not landed";
  const memory = run.deps.threadMemory({ home, number: target.number, repo: `${target.owner}/${target.repo}` });
  if (memory.isErr()) {
    write(`${stopped}: the walkthrough-thread register could not be read (${memory.error.join("; ")})`);
    return false;
  }
  const guarded = { ...read, memory: memory.value };
  const collapsed = collapsedReplies(guarded);
  if (collapsed.length > 0) {
    const threads = read.threads.filter((thread) => collapsed.includes(thread.id));
    const tail = dryRun ? "the landing would reopen them first" : await reopenClause({ run, threads });
    write(
      `${stopped}: ${String(collapsed.length)} walkthrough thread(s) the landing resolved hold somebody else's ` +
        `reply under that resolve; ${tail}. ${ANSWER_EACH}`,
    );
    writeAnswers({ run, threads });
    return false;
  }
  const unanswered = unansweredReplies(guarded);
  if (unanswered.length > 0) {
    write(
      `${stopped}: ${String(unanswered.length)} of our walkthrough thread(s) hold a colleague's reply nobody ` +
        `has answered (${unanswered.join(", ")}); ${ANSWER_EACH}`,
    );
    writeAnswers({ run, threads: read.threads.filter((candidate) => unanswered.includes(candidate.id)) });
    return false;
  }
  return true;
}

/** What every reply refusal asks of the owner, above the lines {@link writeAnswers} prints. */
export const ANSWER_EACH =
  "answer each with the command beneath it, then run it again — a resolve with no answer is reopened";

/**
 * Print {@link answerLines} for each thread, beneath the refusal that names them.
 *
 * @param run the step run whose output channel, pull request and home the lines use
 * @param threads the threads holding a reply, as a read carrying bodies returned them
 */
export function writeAnswers({ run, threads }: { run: StepRun; threads: readonly PrReviewThread[] }): void {
  for (const thread of threads) {
    for (const line of answerLines({ run, thread })) {
      run.write(line);
    }
  }
}

/**
 * One unanswered reply as the refusal shows it: where it sits, who wrote it, its text, and the command that
 * answers it. The answer is what clears the hold, because a reply of the owner's is the last word both guards read; a
 * bare resolve is reopened, since GitHub records it under the login the landing's own resolves use.
 *
 * @param run the step run whose pull request and home the command addresses
 * @param thread the thread holding the reply, as a read carrying bodies returned it
 * @returns the lines to print beneath the refusal
 */
export function answerLines({ run, thread }: { run: StepRun; thread: PrReviewThread }): readonly string[] {
  const where = thread.line > 0 ? `${thread.path}:${String(thread.line)}` : thread.path;
  const text = thread.lastCommentBody.trim();
  const quoted =
    text === "" ? ["    (this read carried no text for it)"] : text.split("\n").map((row) => `    > ${row}`);
  const answer = threadCommand({ extra: ["--body", "-", "--resolve"], run, sub: "reply", threadId: thread.id });
  return [`  ${thread.id} on ${where}, ${thread.lastCommentLogin} replied:`, ...quoted, `    answer: ${answer}`];
}

/**
 * Record each thread the landing reopened as `surfaced` at its current comment count and last reply, so the owner's own
 * resolve after that reopen stands and only a newer reply reopens it again.
 *
 * @param run the step run the register is written through
 * @param threads the threads the refusal names, as the read returned them
 * @returns the clause saying the register could not record them, or an empty string
 */
function recordShown({ run, threads }: { run: StepRun; threads: readonly PrReviewThread[] }): string {
  const unrecorded = run.deps.rememberThreads({
    acts: threads.map((thread) => ({
      kind: "surfaced",
      replyAtIso: thread.lastCommentAtIso,
      replyCount: thread.commentCount,
      threadId: thread.id,
    })),
    home: run.home,
    number: run.target.number,
    repo: `${run.target.owner}/${run.target.repo}`,
  });
  return unrecorded === undefined ? "" : ` (the register could not record the reopen: ${unrecorded})`;
}
