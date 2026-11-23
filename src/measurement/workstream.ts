/**
 * Composing one workstream's whole picture: the doc, its run journal, its drive, and the world.
 *
 * The order is the point. Everything cheap and local is read first (the doc, the journal), because those decide
 * WHETHER to pay for the expensive measurements at all — a workstream with no run does not need a `gh pr view`.
 * Then git and `gh` are asked, and every failure becomes a printable reason rather than a gap.
 *
 * Recomputed on every call, with no cache. That is the whole design: a cache would hide exactly the drift the
 * pane exists to surface, and the measured cost of not caching is one `git` triple plus one `gh` call per
 * workstream — cheap next to a fleet of agents each running a full toolchain.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { runDisposition } from "../handover/boardTypes.js";
import { consistencyOf } from "../handover/consistency.js";
import type { HandoverDoc } from "../handover/doc.js";
import { repoProbeSeams } from "../handover/evaluate.js";
import { type ParsedLedger, type RunState, runStateOf } from "../handover/ledger.js";
import { evaluateProbes, type ProbeResult } from "../handover/probe.js";
import { readRunJournal } from "../handover/runStore.js";
import { scanBoard } from "../handover/store.js";
import { worktreePath } from "../worktree/location.js";
import { measureGit, measurePr } from "./measure.js";
import { DEFAULT_CLAIM_STALE_MS, runClaimFor } from "./overlap.js";
import {
  type Completion,
  type CompletionFacts,
  completionOf,
  type DrivePhase,
  type DriveState,
  driveStateOf,
} from "./runState.js";
import { type SessionRoster, sessionLiveness } from "./sessions.js";
import {
  type AgentFacts,
  type GitFacts,
  type Measured,
  measured,
  type PrFacts,
  type ProbeTally,
  unmeasurable,
  type WorkstreamStatus,
} from "./status.js";

/** The directory sibling a workstream's worktree used to live in, relative to the repository's parent. */
const WORKTREE_DIR_SUFFIX = "-fleet";

/**
 * Where a workstream's worktree would live, were one still created for it.
 *
 * A SIBLING of the repository (`<repo>-fleet/<slug>`), never a child — a worktree inside the repository would
 * be inside its own `git status`, which would make every workstream's `dirtyFiles` count everyone else's too.
 * Superseded by {@link canonicalWorktreePath} for every spawn from here on; this path shape survives purely for
 * worktrees created under the old convention before the switch, and for one started by hand under it, which is
 * still a tree {@link treeFor} should find.
 *
 * @param repo the repository root
 * @param slug the workstream's slug
 * @returns the absolute worktree path
 */
export function fleetWorktreePath({ repo, slug }: { repo: string; slug: string }): string {
  return join(`${repo.replace(/\/+$/, "")}${WORKTREE_DIR_SUFFIX}`, slug);
}

/**
 * Where a workstream's worktree lives under the current convention: inside the repository's own
 * `.claude/worktrees.noindex/`, keyed by slug — a CHILD, unlike the retired {@link fleetWorktreePath} sibling
 * convention, because `cmux spawn` now creates it there directly.
 *
 * @param repo the repository root
 * @param slug the workstream's slug
 * @returns the absolute worktree path
 */
export function canonicalWorktreePath({ repo, slug }: { repo: string; slug: string }): string {
  return worktreePath({ name: slug, repoRoot: repo });
}

/**
 * Where a workstream's turn output would have been appended, had one been launched.
 *
 * One file per workstream rather than per turn, so reading it shows a whole drive's history in order. It lives
 * beside the run journal, which is the directory this design already relies on surviving a compaction.
 *
 * @param runsDir the runs directory
 * @param slug the workstream's slug
 * @returns the absolute log path
 */
export function turnLogPath({ runsDir, slug }: { runsDir: string; slug: string }): string {
  return join(runsDir, `${slug}.turns.log`);
}

/** Everything known about one workstream, before it is rendered or driven. */
export interface Workstream {
  readonly doc: HandoverDoc;
  readonly run: RunState;
  /**
   * The run's phase, with "nobody has ever started this" kept apart from "it is closed".
   *
   * Derived here rather than read off `run.phase`, because `NO_RUN.phase` is `closed` and conflating the two
   * made a drive against an unstarted doc report itself `settled`. See {@link ./runState.DrivePhase}.
   */
  readonly phase: DrivePhase;
  readonly drive: DriveState;
  readonly journal: ParsedLedger;
  readonly probes: readonly ProbeResult[];
  readonly tally: ProbeTally;
  readonly git: Measured<GitFacts>;
  readonly pr: Measured<PrFacts | null>;
  readonly agent: Measured<AgentFacts | null>;
  readonly completion: Completion;
  /** The tree this workstream's git facts were measured in, and the reason it was chosen. */
  readonly tree: Measured<string>;
}

/**
 * Which tree a workstream's git facts come from, most exact first.
 *
 * Four sources, and only the first is a fact: the worktree the drive RECORDED when it launched, then the
 * current canonical worktree if it happens to exist, then the retired fleet-convention worktree, then the
 * repository's own checkout. The last is deliberately allowed — a workstream the owner started by hand lives
 * there, and refusing to measure it would make the pane blind to exactly the work it is supposed to be a
 * single view of.
 *
 * @param repo the doc's declared repository, when it declares one
 * @param slug the workstream's slug
 * @param launchedWorktree the worktree recorded at launch, when a drive has launched
 * @returns the tree to measure, or the reason there is none
 */
function treeFor({
  repo,
  slug,
  launchedWorktree,
}: {
  repo: string | undefined;
  slug: string;
  launchedWorktree: string | undefined;
}): Measured<string> {
  if (launchedWorktree !== undefined && existsSync(launchedWorktree)) {
    return measured({ value: launchedWorktree });
  }
  if (launchedWorktree !== undefined) {
    return unmeasurable({ why: `the drive launched in ${launchedWorktree}, which no longer exists` });
  }
  if (repo === undefined) {
    return unmeasurable({ why: "the doc declares no `repo:`, so there is no tree to measure" });
  }
  const canonicalTree = canonicalWorktreePath({ repo, slug });
  if (existsSync(canonicalTree)) {
    return measured({ value: canonicalTree });
  }
  const fleetTree = fleetWorktreePath({ repo, slug });
  if (existsSync(fleetTree)) {
    return measured({ value: fleetTree });
  }
  return existsSync(repo)
    ? measured({ value: repo })
    : unmeasurable({ why: `none of ${canonicalTree}, ${fleetTree} or ${repo} exists` });
}

/** Count the probe outcomes. `unchecked` stays apart: "nothing looked" is not "it failed". */
function tallyOf({ results }: { results: readonly ProbeResult[] }): ProbeTally {
  return {
    failed: results.filter((result) => result.outcome === "fail").length,
    passed: results.filter((result) => result.outcome === "pass").length,
    unchecked: results.filter((result) => result.outcome === "not-evaluated").length,
  };
}

/**
 * Evaluate a doc's declared probes against its repository.
 *
 * `command:` probes are declined here, the same way `handover list` declines them: the pane recomputes on every
 * call, so running one doc's arbitrary shell every time somebody looks at the fleet is not a cost worth paying.
 * They report as `not-evaluated`, which the tally keeps separate and completion refuses to call done.
 */
function probesOf({ doc }: { doc: HandoverDoc }): readonly ProbeResult[] {
  if (doc.repo === undefined) {
    return doc.doneWhen.map((probe) => ({
      note: "the doc declares no `repo:`, so nothing could be resolved against it",
      outcome: "not-evaluated" as const,
      probe,
    }));
  }
  return evaluateProbes({
    probes: doc.doneWhen,
    seams: repoProbeSeams({ repo: doc.repo, runCommand: undefined }),
  });
}

/**
 * The agent facts for a drive, or a known `null` when nothing has been launched.
 *
 * A recorded pid is no longer required for a row: the SESSION is the identity, and a journal that names one
 * without a pid still describes a real drive. Requiring the pid was part of the same mistake as trusting it.
 */
function agentOf({
  drive,
  runsDir,
  slug,
  roster,
}: {
  drive: DriveState;
  runsDir: string;
  slug: string;
  roster: Measured<SessionRoster>;
}): Measured<AgentFacts | null> {
  if (drive.sessionId === undefined) {
    return measured({ value: null });
  }
  return measured({
    value: {
      liveness: sessionLiveness({ roster, sessionId: drive.sessionId }),
      logPath: turnLogPath({ runsDir, slug }),
      pid: drive.pid,
      sessionId: drive.sessionId,
    },
  });
}

/**
 * Measure one workstream end to end.
 *
 * @param doc the orchestration doc
 * @param runsDir where run journals live
 * @param base the branch commits are counted against, or `undefined` to resolve each repository's own trunk
 * @param roster the live sessions, so liveness is asked of the session rather than of a recorded pid
 * @returns everything the pane needs, with every failure carrying its reason
 */
export function measureWorkstream({
  doc,
  runsDir,
  base,
  roster,
}: {
  doc: HandoverDoc;
  runsDir: string;
  base: string | undefined;
  roster: Measured<SessionRoster>;
}): Workstream {
  const read = readRunJournal({ runsDir, slug: doc.slug });
  const journal: ParsedLedger = read.isOk() ? read.value : { events: [], unknownKind: [], unreadable: [] };
  const run = runStateOf({ events: journal.events });
  const drive = driveStateOf({ events: journal.events });
  const probes = probesOf({ doc });
  const tally = tallyOf({ results: probes });
  const tree = treeFor({ launchedWorktree: drive.worktree, repo: doc.repo, slug: doc.slug });
  const git = tree.known ? measureGit({ base, worktree: tree.value }) : unmeasurable<GitFacts>({ why: tree.why });
  const pr = prFor({ git, tree });
  return {
    agent: agentOf({ drive, roster, runsDir, slug: doc.slug }),
    completion: completionOf({ facts: completionFactsOf({ git, pr, tally }) }),
    doc,
    drive,
    git,
    journal,
    // A journal with no events at all has never been started. Checked on the EVENT LIST rather than on
    // `run.phase`, which is `closed` for both states — see `Workstream.phase`.
    phase: journal.events.length === 0 ? "no-run" : run.phase,
    pr,
    probes,
    run,
    tally,
    tree,
  };
}

/** Ask `gh` only when there is a branch to ask about, propagating the reason when there is not. */
function prFor({ git, tree }: { git: Measured<GitFacts>; tree: Measured<string> }): Measured<PrFacts | null> {
  if (!tree.known) {
    return unmeasurable({ why: tree.why });
  }
  if (!git.known) {
    return unmeasurable({ why: `the branch could not be read, so no pull request could be looked up (${git.why})` });
  }
  return measurePr({ branch: git.value.branch, worktree: tree.value });
}

/**
 * Fold the measurements into the completion facts.
 *
 * An unmeasurable git or `gh` answer becomes the SAFE value — not on the remote, no PR, `unknown` checks —
 * because completion is what stops a drive, and a failed measurement must never be able to stop one early. The
 * pane still prints the real reason; only the drive decision treats it as "not proven".
 */
function completionFactsOf({
  git,
  pr,
  tally,
}: {
  git: Measured<GitFacts>;
  pr: Measured<PrFacts | null>;
  tally: ProbeTally;
}): CompletionFacts {
  const prValue = pr.known ? pr.value : null;
  return {
    branchOnRemote: git.known && git.value.onRemote,
    checks: prValue === null ? "unknown" : prValue.rollup,
    prOpen: prValue !== null,
    probesFailing: tally.failed,
    probesUnchecked: tally.unchecked,
  };
}

/**
 * The workstreams the pane covers.
 *
 * Every doc with a run that is OPEN or WAITING ON THE OWNER, plus every slug the caller named. A closed run is
 * excluded because `handover list` already reports it and a pane that never forgets anything stops being one
 * view; a NAMED slug is always included, because someone asking about a specific workstream should be told
 * about it even when the answer is "nothing has ever run here".
 *
 * @param handoverDir where the docs live
 * @param runsDir where run journals live
 * @param slugs the slugs the caller named, empty for the default set
 * @returns the docs to measure, in slug order, plus the named slugs that no doc claims
 */
export function fleetDocs({
  handoverDir,
  runsDir,
  slugs,
}: {
  handoverDir: string;
  runsDir: string;
  slugs: readonly string[];
}): {
  readonly docs: readonly HandoverDoc[];
  readonly unknown: readonly string[];
  readonly problem: string | undefined;
} {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return { docs: [], problem: scan.error.message, unknown: [] };
  }
  const named = new Set(slugs);
  const unknown = slugs.filter((slug) => !scan.value.docs.some((doc) => doc.slug === slug));
  const docs = scan.value.docs.filter((doc) => (named.size > 0 ? named.has(doc.slug) : hasLiveRun({ doc, runsDir })));
  return { docs: [...docs].toSorted((a, b) => a.slug.localeCompare(b.slug)), problem: undefined, unknown };
}

/** Whether a doc's journal shows a run that has not been closed. One journal read, no measurement. */
function hasLiveRun({ doc, runsDir }: { doc: HandoverDoc; runsDir: string }): boolean {
  const read = readRunJournal({ runsDir, slug: doc.slug });
  if (read.isErr()) {
    // An unreadable journal is INCLUDED rather than skipped: the pane's job is to say it could not read it,
    // and dropping the workstream would make an I/O failure look like an absence of work.
    return true;
  }
  return runStateOf({ events: read.value.events }).phase !== "closed";
}

/**
 * Turn a measured workstream into the pane's row shape.
 *
 * @param workstream the measured workstream
 * @param nowMs the instant ages are computed against
 * @param roster the live sessions, so the claim row asks about the session rather than a recorded pid
 * @returns the pane row
 */
export function statusOf({
  workstream,
  nowMs,
  roster,
}: {
  workstream: Workstream;
  nowMs: number;
  roster: Measured<SessionRoster>;
}): WorkstreamStatus {
  const last = workstream.journal.events[workstream.journal.events.length - 1];
  return {
    agent: workstream.agent,
    authoredStatus: workstream.doc.status,
    // Derived from the journal ALREADY READ above rather than re-read here. Two reads would describe two
    // different moments, and a pane whose claim row disagrees with its own phase row is a board that lies.
    claim: runClaimFor({
      doc: workstream.doc,
      journal: workstream.journal,
      seams: {
        nowMs,
        sessionLive: ({ sessionId }) => sessionLiveness({ roster, sessionId }),
        staleAfterMs: DEFAULT_CLAIM_STALE_MS,
      },
    }),
    // Same journal already read above, not a second one — see the `claim` comment just above.
    consistency: consistencyOf({
      run: runDisposition({ events: workstream.journal.events, unreadableLines: workstream.journal.unreadable }),
      status: workstream.doc.status,
    }),
    git: workstream.git,
    lastTransition:
      last === undefined
        ? unmeasurable({ why: "this doc has no run journal yet" })
        : measured({ value: { ageMs: nowMs - Date.parse(last.atIso), kind: last.kind } }),
    openQuestion: workstream.run.openQuestion,
    phase: workstream.phase,
    pr: workstream.pr,
    probes: workstream.tally,
    slug: workstream.doc.slug,
    statusSummary: workstream.doc.statusSummary,
  };
}
