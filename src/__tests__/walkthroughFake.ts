/**
 * A plain fake for the landing verbs' walkthrough step (`cli/commands/github/walkthroughStep.ts`): a thread
 * read that answers what the case hands it, a resolve that answers the exit code the case chose, and a record
 * of every write so a case can assert on it. Not a mock — every edge is a plain function.
 */

import type { AutonomyActionRow } from "../autonomy/types.js";
import type { WalkthroughRead, WalkthroughStepDeps } from "../cli/commands/github/walkthroughStep.js";
import { err, ok } from "../lib/result.js";
import type { PrReviewThread } from "../live/github/reviewState.js";
import { type WalkthroughAct, walkthroughMemory } from "../outbound/github/walkthroughLedger.js";

/** Everything the fake was asked to write, in order. */
export interface WalkthroughWrites {
  /** The `--thread` of every resolve asked for. */
  readonly resolved: string[];
  readonly ledger: AutonomyActionRow[];
}

/**
 * One review thread, defaulting to the owner's own one-voice walkthrough note on `acme/widget`.
 *
 * @param over the fields a case changes
 * @returns the thread
 */
export function walkthroughThread(over: Partial<PrReviewThread> = {}): PrReviewThread {
  return {
    commentCount: 1,
    id: "PRRT_note1",
    isOutdated: false,
    isResolved: false,
    lastCommentAtIso: "2026-09-28T04:00:00.000Z",
    lastCommentBody: "",
    lastCommentLogin: "owner",
    line: 12,
    openedAtIso: "2026-09-28T04:00:00.000Z",
    openedByLogin: "owner",
    openerBody: "",
    path: "src/a.ts",
    ...over,
  };
}

/**
 * What a thread read answers now: the case's own read until a resolve goes out, then that read with every
 * resolve that succeeded marked resolved and the case's `afterResolve` applied.
 *
 * @param resolved the `--thread` of every resolve asked for so far
 * @returns the read, or `undefined` for one that fails
 */
function currentRead({
  read,
  resolved,
  failIds,
  afterResolve,
  rereadTruncated,
}: {
  read: WalkthroughRead | undefined;
  resolved: readonly string[];
  failIds: readonly string[];
  afterResolve: (thread: PrReviewThread) => PrReviewThread;
  rereadTruncated: boolean;
}): WalkthroughRead | undefined {
  if (read === undefined || resolved.length === 0) {
    return read;
  }
  const done = new Set(resolved.filter((id) => !failIds.includes(id)));
  const threads = read.threads.map((thread) =>
    afterResolve(done.has(thread.id) ? { ...thread, isResolved: true, resolvedByLogin: read.viewerLogin } : thread),
  );
  return { ...read, threads, truncated: read.truncated || rereadTruncated };
}

/**
 * The register as the step reads it, off every act the fake has recorded on `acme/widget` #1.
 *
 * @param memory every act recorded so far, in order
 * @returns what the register remembers
 */
function memoryOf({ memory }: { memory: readonly WalkthroughAct[] }): ReturnType<typeof walkthroughMemory> {
  return walkthroughMemory({
    number: 1,
    repo: "acme/widget",
    rows: memory.map((row) => ({ ...row, atIso: "2026-09-28T05:00:00.000Z", number: 1, repo: "acme/widget" })),
  });
}

/**
 * The fake edges.
 *
 * @param read what the thread read answers; `undefined` makes it fail
 * @param failIds thread ids whose resolve exits non-zero
 * @param writes where every write is recorded
 * @param beforeResolve called on each resolve before it answers, so a case can capture ordering
 * @param afterResolve what GitHub does to a thread once a resolve has gone out — a reply landing, a reopen —
 *   applied to every read after the first resolve, over a thread a resolve succeeded on already marked resolved
 * @param reopened where the `--thread` of every reopen is recorded, for a case that asserts on it
 * @param unseenAllowed whether the `unseen-review-threads` hatch reads open
 * @param memory the register the step reads, and every row it writes, appended in order
 * @param registerFails the sentence every register write answers with, standing for a write that failed
 * @param rereadTruncated whether every read after the first resolve says GitHub had more threads than it carried
 * @returns the step's deps
 */
export function walkthroughDeps({
  read,
  failIds = [],
  writes,
  beforeResolve = () => undefined,
  afterResolve = (thread) => thread,
  reopened = [],
  unseenAllowed = false,
  memory = [],
  registerFails,
  rereadTruncated = false,
}: {
  read: WalkthroughRead | undefined;
  failIds?: readonly string[];
  writes: WalkthroughWrites;
  beforeResolve?: () => void;
  afterResolve?: (thread: PrReviewThread) => PrReviewThread;
  reopened?: string[];
  unseenAllowed?: boolean;
  memory?: WalkthroughAct[];
  registerFails?: string;
  rereadTruncated?: boolean;
}): WalkthroughStepDeps {
  const current = (): WalkthroughRead | undefined =>
    currentRead({ afterResolve, failIds, read, rereadTruncated, resolved: writes.resolved });
  return {
    now: () => new Date("2026-09-28T05:00:00.000Z"),
    recordAutonomy: ({ row }) => {
      writes.ledger.push(row);
      return Promise.resolve(undefined);
    },
    rememberThreads: ({ acts }) => {
      if (registerFails !== undefined) {
        return registerFails;
      }
      memory.push(...acts);
      return undefined;
    },
    threadMemory: () => ok(memoryOf({ memory })),
    reopenThread: ({ rest }) => {
      reopened.push(rest[rest.indexOf("--thread") + 1]!);
      return Promise.resolve(0);
    },
    resolveThread: ({ rest }) => {
      beforeResolve();
      const thread = rest[rest.indexOf("--thread") + 1]!;
      writes.resolved.push(thread);
      return Promise.resolve(failIds.includes(thread) ? 1 : 0);
    },
    sessionRef: () => "session:test",
    unseenThreadsAllowed: () => unseenAllowed,
    walkthroughs: () => {
      const now = current();
      return Promise.resolve(now === undefined ? err(["github said no"]) : ok(now));
    },
  };
}

/**
 * The fake for a case about something else: the owner's pull request, no threads at all, so the step does nothing.
 *
 * @param headOid the head the case's own pull request read reports, which the step checks the thread read against
 * @returns the step's deps
 */
export function noWalkthroughs({ headOid }: { headOid: string }): WalkthroughStepDeps {
  return walkthroughDeps({
    read: { authorLogin: "owner", headOid, threads: [], truncated: false, viewerLogin: "owner" },
    writes: { ledger: [], resolved: [] },
  });
}
