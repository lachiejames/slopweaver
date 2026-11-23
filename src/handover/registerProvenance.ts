/**
 * Which session registered a board row, and which run it was holding when it did — written on the row by
 * `handover register` so the Queue card can say where it came from when no anchor names the owner's words.
 *
 * A card reading "Nothing records whose words are behind this" leaves the owner with no way to know where
 * something came from. The session that registers a row always knows who it is, and usually which run it holds,
 * so both are written down.
 *
 * The run is found by two cheap candidates, never a board scan: the checkout's current branch and the cwd's own
 * name, because `cmux spawn` seats a run in a worktree and on a branch both named for its slug. A candidate counts
 * only when its journal names THIS session as the run's writer, so a guess never becomes a claim: a session whose
 * worktree and branch are named otherwise records who it is and no run. `page publish` alone falls back, on a miss,
 * to the one open run any journal names this session the writer of: a page left off its run is the defect it closes.
 */

import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";

import { currentBranch } from "../codex/gitDiff.js";
import { stateHomePaths } from "../stateHome.js";
import { type RunEvent, runStateOf } from "./ledger.js";
import { currentSessionId, writerOf } from "./runOwner.js";
import { isSafeSlug, readRunJournal } from "./runStore.js";

/** Who registered a row, and the run it held — each absent when it cannot be established. */
export interface RegisterProvenance {
  readonly registeredBy: string | undefined;
  readonly registeredRun: string | undefined;
}

/**
 * The one candidate run whose journal names `sessionId` as its writer.
 *
 * @param sessionId the registering session
 * @param journals each candidate slug with its journal's events, in the order they were proposed
 * @returns the first candidate this session writes, or `undefined` when it writes none of them
 */
export function heldRunAmong({
  sessionId,
  journals,
}: {
  sessionId: string;
  journals: readonly { readonly slug: string; readonly events: readonly RunEvent[] }[];
}): string | undefined {
  return journals.find((journal) => writerOf({ events: journal.events })?.sessionId === sessionId)?.slug;
}

/**
 * The provenance `handover register` writes on a row, read off the environment, the checkout and at most two
 * journals.
 *
 * @param env the environment the session id is read from
 * @param home the state home whose runs directory holds the journals
 * @param cwd the directory the verb ran in
 * @returns the registering session and the run it holds, each absent when not established
 */
export function registerProvenance({
  env,
  home,
  cwd,
}: {
  env: NodeJS.ProcessEnv;
  home: string;
  cwd: string;
}): RegisterProvenance {
  const sessionId = currentSessionId({ env });
  if (sessionId === undefined) {
    return { registeredBy: undefined, registeredRun: undefined };
  }
  return { registeredBy: sessionId, registeredRun: heldRunOf({ cwd, home, sessionId }) };
}

/**
 * The run the current session holds, by the same two candidates {@link registerProvenance} reads — what `page
 * publish` attaches a page to, so a page's run knows its deliverable as a typed `artifact` event.
 *
 * @param env the environment the session id is read from
 * @param home the state home whose runs directory holds the journals
 * @param cwd the directory the verb ran in
 * @returns the held run's slug, or `undefined` when no session id is set or no candidate names this session
 */
export function heldRunSlug({
  env,
  home,
  cwd,
}: {
  env: NodeJS.ProcessEnv;
  home: string;
  cwd: string;
}): string | undefined {
  const sessionId = currentSessionId({ env });
  if (sessionId === undefined) {
    return undefined;
  }
  const named = heldRunOf({ cwd, home, sessionId });
  if (named !== undefined) {
    return named;
  }
  // A run started with `--branch` named otherwise, from a checkout named otherwise, is still this session's: a page
  // publish that missed it would leave the page unrecorded and let `finish` close past it. So a miss
  // reads every journal — 252 on the measured home (`ls ~/.slopweaver/runs | wc -l`).
  return soleOpenRunWrittenBy({ journals: everyJournal({ home }), sessionId });
}

/**
 * The one OPEN run whose journal names `sessionId` as its writer, when there is exactly one.
 *
 * @param sessionId the publishing session
 * @param journals every run's slug with its journal's events
 * @returns that run's slug, or `undefined` when the session writes no open run or more than one
 */
export function soleOpenRunWrittenBy({
  sessionId,
  journals,
}: {
  sessionId: string;
  journals: readonly { readonly slug: string; readonly events: readonly RunEvent[] }[];
}): string | undefined {
  const open = journals.filter(
    (journal) =>
      runStateOf({ events: journal.events }).phase !== "closed" &&
      writerOf({ events: journal.events })?.sessionId === sessionId,
  );
  return open.length === 1 ? open[0]!.slug : undefined;
}

/** Every readable run journal under the home, by slug; none when the runs directory does not exist yet. */
function everyJournal({ home }: { home: string }): { slug: string; events: readonly RunEvent[] }[] {
  const runsDir = stateHomePaths({ home }).runs;
  if (!existsSync(runsDir)) {
    return [];
  }
  return readdirSync(runsDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => name.slice(0, -".jsonl".length))
    .filter((slug) => isSafeSlug({ slug }))
    .flatMap((slug) => {
      const journal = readRunJournal({ runsDir, slug });
      return journal.isOk() ? [{ events: journal.value.events, slug }] : [];
    });
}

/** The candidate run this session writes, by branch then cwd name. */
function heldRunOf({ cwd, home, sessionId }: { cwd: string; home: string; sessionId: string }): string | undefined {
  const branch = currentBranch({ cwd });
  const candidates = [branch.isOk() ? branch.value : null, basename(cwd)].filter(
    (slug): slug is string => slug !== null && isSafeSlug({ slug }),
  );
  const journals = [...new Set(candidates)].flatMap((slug) => {
    const journal = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug });
    return journal.isOk() ? [{ events: journal.value.events, slug }] : [];
  });
  return heldRunAmong({ journals, sessionId });
}
