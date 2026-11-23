/**
 * The streaming reads one reconcile needs. A line at a time, never a whole-file read: Linear bronze alone is
 * ~600 MB on the real home and the structures lane is ~4 MB, so the prefilter is a constant-heap scan rather
 * than a retrieval load. Measured: the whole owner-scoped Linear prefilter runs in well under a
 * second on that corpus.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { type BronzeFileStat, listBronzeFiles } from "../../../corpus/bronzeStorage.js";
import type { PullRequestState } from "../../../cycle/classify.js";
import { type CycleWindow, cycleWindowOf } from "../../../cycle/currentCycle.js";
import { type CycleIssue, cycleIssueOf, newestPerIssue } from "../../../cycle/issue.js";
import {
  type CycleProject,
  type CycleProjectUpdate,
  cycleProjectOf,
  cycleProjectUpdateOf,
  newestPerProject,
  withBronzeUpdates,
} from "../../../cycle/projectHistory.js";
import { type PullRequestOutcome, pullRequestOutcomeOf, pullRequestStates } from "../../../cycle/pullRequests.js";
import { isRecord } from "../../../lib/parsers.js";

/** Every line of one file, streamed. */
async function* linesOf({ path }: { path: string }): AsyncGenerator<string> {
  const reader = createInterface({ crlfDelay: Infinity, input: createReadStream(path) });
  for await (const line of reader) {
    yield line;
  }
}

/**
 * Every cycle row in the structures lane.
 *
 * @param path the home's `corpus/structures/linear.jsonl`
 * @returns the cycle windows, in file order
 */
export async function readCycleWindows({ path }: { path: string }): Promise<readonly CycleWindow[]> {
  const windows: CycleWindow[] = [];
  try {
    for await (const line of linesOf({ path })) {
      const window = cycleWindowOf({ line });
      if (window !== undefined) {
        windows.push(window);
      }
    }
  } catch {
    return [];
  }
  return windows;
}

/**
 * Both Linear lanes a reconcile reads, gathered in ONE pass over bronze rather than two.
 *
 * @internal — the shape {@link readLinearScan} returns; no caller outside this noun names it.
 */
export interface LinearScan {
  readonly issues: readonly CycleIssue[];
  readonly projects: readonly CycleProject[];
  /** Lines naming themselves an issue, project or project update that no parser could read — a gap, never a silent drop. */
  readonly unreadable: number;
}

/**
 * Whether a line no parser accepted is still a record this scan FAILED rather than one it has no use for: not
 * a JSON object at all (cut off, say), an issue or a project, or a project update that is not archived — an
 * archived update being the one deliberate skip. Parsed rather than substring-matched, so a record's spacing
 * or escaping cannot hide it. Measured on the real home: 0 such lines among 185,921, with 65,348
 * issues and projects and 2,210 project updates all read (and 244 initiative updates, skipped by their `initiativeUpdate:` id), and the extra parse cost 1.2s over a 2.1s streamed
 * read. Repro: `node -e` a JSON.parse over `~/.slopweaver/corpus/bronze/linear/*.jsonl`.
 */
function isFailedLinearLine({ line }: { line: string }): boolean {
  if (line.trim().length === 0) {
    return false;
  }
  const parsed = safeParseLine({ line });
  if (!isRecord(parsed)) {
    return true;
  }
  const kind = parsed["kind"];
  if (kind === "issue" || kind === "project") {
    return true;
  }
  const sourceId = parsed["sourceId"];
  const raw = isRecord(parsed["raw"]) ? parsed["raw"] : undefined;
  // An initiative update is the one update this scan has no use for; any other may be a project's, however
  // it is spelled (a legacy one is tied to its project by URL alone).
  const isInitiativeUpdate = typeof sourceId === "string" && sourceId.startsWith("initiativeUpdate:");
  if (kind !== "update" || isInitiativeUpdate) {
    return false;
  }
  return typeof raw?.["archivedAt"] !== "string";
}

/** Every repository's release instants, and the lines the scan could not read. */
export interface ReleaseScan {
  readonly instants: ReadonlyMap<string, readonly string[]>;
  readonly unreadable: number;
}

/** What one Linear scan accumulates before the newest-row reduction. */
interface ScanBuffers {
  readonly issues: CycleIssue[];
  readonly projects: CycleProject[];
  readonly updates: CycleProjectUpdate[];
}

/** Push one line into the first buffer whose parser accepts it; false when none did. */
function scanLine({ line, into }: { line: string; into: ScanBuffers }): boolean {
  const issue = cycleIssueOf({ line });
  if (issue !== undefined) {
    into.issues.push(issue);
    return true;
  }
  const project = cycleProjectOf({ line });
  if (project !== undefined) {
    into.projects.push(project);
    return true;
  }
  const update = cycleProjectUpdateOf({ line });
  if (update !== undefined) {
    into.updates.push(update);
    return true;
  }
  return false;
}

/**
 * One source's bronze files, strictly listed and judged by the owner's protect list. The pass checks every source it
 * reads lists first (`./pass.ts`'s `unreadableBronze`), so a listing that fails here changed in between: it is thrown,
 * exactly as a strict listing always threw, and never read as an empty source.
 *
 * @param home the state home whose bronze is read
 * @param source the source to list
 * @returns the files, in bronze read order
 */
function strictBronzeFiles({ home, source }: { home: string; source: "linear" | "github" }): readonly BronzeFileStat[] {
  const listed = listBronzeFiles({ home, source, strict: true });
  if (listed.isErr()) {
    throw new Error(listed.error.message);
  }
  return listed.value;
}

/**
 * Every issue and project in a home's Linear bronze, reduced to the newest row each, each project carrying
 * the update history its standalone update records add to its own.
 *
 * One pass rather than two, because bronze is the largest thing this verb touches and reading it twice
 * doubles the only cost that matters.
 *
 * @param home the state home whose bronze is read
 * @returns the newest row per issue identifier and per project id, and how many issue, project or project-update lines it could not read
 */
export async function readLinearScan({ home }: { home: string }): Promise<LinearScan> {
  const into: ScanBuffers = { issues: [], projects: [], updates: [] };
  let unreadable = 0;
  for (const file of strictBronzeFiles({ home, source: "linear" })) {
    for await (const line of linesOf({ path: file.path })) {
      if (!scanLine({ into, line }) && isFailedLinearLine({ line })) {
        unreadable += 1;
      }
    }
  }
  return {
    issues: newestPerIssue({ issues: into.issues }),
    projects: withBronzeUpdates({ projects: newestPerProject({ projects: into.projects }), updates: into.updates }),
    unreadable,
  };
}

/**
 * How every pull request in a home's GitHub bronze ended, keyed by URL.
 *
 * @param home the state home whose bronze is read
 * @returns the state of each pull request the corpus has seen
 */
export async function readPullRequestStates({
  home,
}: {
  home: string;
}): Promise<ReadonlyMap<string, PullRequestState>> {
  const outcomes: PullRequestOutcome[] = [];
  for (const file of strictBronzeFiles({ home, source: "github" })) {
    for await (const line of linesOf({ path: file.path })) {
      const outcome = pullRequestOutcomeOf({ line });
      if (outcome !== undefined) {
        outcomes.push(outcome);
      }
    }
  }
  return pullRequestStates({ outcomes });
}

/**
 * Every repository's release instants, from GitHub bronze.
 *
 * Releases are the clock the close half judges a `Merged` ticket against, per the owner's
 * ruling that the job moving Merged to Done runs around release time. Read here rather than live because
 * the question is "has this repo shipped since", which a corpus answers as well as the provider does, and
 * one more live leg on a daily card is a cost with no matching gain.
 *
 * @param home the state home to read
 * @returns release instants per `owner/name`, ascending, and how many release or cut-off lines it could not read
 */
export async function readReleaseInstants({ home }: { home: string }): Promise<ReleaseScan> {
  const byRepo = new Map<string, string[]>();
  let unreadable = 0;
  for (const file of strictBronzeFiles({ home, source: "github" })) {
    for await (const line of linesOf({ path: file.path })) {
      const release = releaseOf({ line });
      if (release === "failed") {
        unreadable += 1;
        continue;
      }
      if (release === undefined) {
        continue;
      }
      const held = byRepo.get(release.repo);
      if (held === undefined) {
        byRepo.set(release.repo, [release.tsIso]);
        continue;
      }
      held.push(release.tsIso);
    }
  }
  return { instants: new Map([...byRepo].map(([repo, instants]) => [repo, instants.toSorted()])), unreadable };
}

/**
 * One GitHub bronze line read as a release: the release, `undefined` for a record of another kind or a blank
 * line, or `"failed"` for a line that is not a JSON object or is a release missing its repo or instant. Every
 * line is parsed, never substring-matched, so spacing cannot hide one. Measured on the real home:
 * all 216 release lines read and none of 234,366 lines failed, and the parse cost 0.8s over a 7.1s streamed
 * read. Repro: `node -e` a JSON.parse over `~/.slopweaver/corpus/bronze/github/*.jsonl`.
 */
function releaseOf({ line }: { line: string }): { repo: string; tsIso: string } | "failed" | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  const parsed: unknown = safeParseLine({ line });
  if (!isRecord(parsed)) {
    return "failed";
  }
  if (parsed["kind"] !== "release") {
    return undefined;
  }
  const repo = parsed["container"];
  const tsIso = parsed["tsIso"];
  if (typeof repo !== "string" || typeof tsIso !== "string" || tsIso.length === 0) {
    return "failed";
  }
  return { repo, tsIso };
}

/** `JSON.parse` that answers `undefined` rather than throwing. */
function safeParseLine({ line }: { line: string }): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
