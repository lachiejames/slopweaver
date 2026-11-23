/**
 * The fleet's context depth, one row per live Claude session — the gauge the supervisor's sweep reads instead
 * of scraping each session's `/clear to save …` hint off its screen.
 *
 * ## Why a join, and why on `cwd`
 *
 * Three sources each hold a third of the answer and none holds it alone. The session registry knows WHICH
 * Claude processes exist and where each one's transcript is; the transcript knows how deep it is; cmux knows
 * which workspace a human is looking at, and the session ledger knows which handover slug a workspace was
 * dispatched for. `cwd` is the one key every one of them carries — the same join `./watchReport.ts` already
 * makes, and the same one `cli/commands/session/standingWorkspaces.ts` uses to find a tracked session's workspace.
 *
 * It is a join on a directory, so it is not an identity: two sessions opened in one checkout share a cwd and
 * therefore share a workspace label. That is stated on the row (see {@link SessionDepthRow.cwdShared}) rather
 * than resolved, because there is no reliable way to learn a spawned chat's Claude Code session identity —
 * the reason `./session.ts` is keyed by slug in the first place.
 *
 * ## Standing sessions are IN scope, and that is the owner's own correction
 *
 * The obvious carve-out is to exempt the long-lived session — the Slack loop — from a respawn gauge because
 * closing it takes the bot off the air. The owner ruled the opposite after a loop session was
 * measured at 616k tokens and still growing: it is near-stateless BY DESIGN, with everything durable already
 * on disk (arm/pid, ask lifecycle, cursors), so it "should be closed and respawned on a gauge, not nursed".
 *
 * So a standing session is MARKED, never skipped. The mark changes the respawn PATH a reader takes — a
 * standing session is restarted through its own start verb, a worker through amend/close/respawn of the same
 * slug — and it never changes whether the row appears or how its depth is judged. What stays exempt is a
 * judgement call nothing here can make: a session mid-investigation whose value IS its accumulated context.
 * That is why this reports a candidate and never acts on one.
 *
 * Pure: every fact a caller could only get by reading something is passed in already-read. The filesystem,
 * the cmux socket and the clock live in `cli/commands/session/depth.ts`.
 */
import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import { type Measured, measured, unmeasurable } from "../measurement/status.js";
import type { SessionRecord } from "./liveSessions.js";
import type { ModelWeightedUsage } from "./modelWeight.js";
import type { SessionItem } from "./session.js";
import { compactTokens, type ModelUsageTotals, type UsageTotals } from "./sessionCost.js";
import { type ContextDepth, type DepthVerdict, depthVerdict } from "./tokenDepth.js";

/** Why a session is one the fleet keeps alive on purpose, rather than one dispatched for a piece of work. */
type StandingKind = "loop";

/** One live Claude session, with everything four sources know about it joined onto one row. */
export interface SessionDepthRow {
  /** Claude Code's own session id — the transcript's filename, and the only exact key on this row. */
  readonly sessionId: string;
  readonly pid: number;
  readonly cwd: string;
  /** True when another live session shares this cwd, so the workspace and ledger labels below are ambiguous. */
  readonly cwdShared: boolean;
  /** The cmux workspace opened in this cwd, when one is. */
  readonly workspaceRef: string | undefined;
  /** That workspace's title — what the owner actually reads in the sidebar. */
  readonly title: string | undefined;
  /** The ledger's session key for this cwd, when the ledger tracks one that is still open. */
  readonly sessionKey: string | undefined;
  /** The handover slug that key was dispatched for, when it names one. */
  readonly slug: string | undefined;
  /** Set when this is one of the sessions the fleet keeps alive on purpose — see this module's header. */
  readonly standing: StandingKind | undefined;
  /**
   * True when this row is the CALLING session's own.
   *
   * Matched on Claude Code's own `CLAUDE_CODE_SESSION_ID`, which is exact rather than a `cwd` join — measured, its value is byte-identical to the registry's `sessionId` for the same process. That is what
   * makes "read your own depth at a phase boundary" a lookup rather than a guess, in a fleet where three
   * sessions can share one worktree.
   */
  readonly self: boolean;
  /** The newest turn's context depth, or the reason it could not be read. Never a comforting zero. */
  readonly depth: Measured<ContextDepth>;
  /** The gauge's verdict, or the reason there is none because the depth could not be read. */
  readonly verdict: Measured<DepthVerdict>;
  /**
   * What this session has SPENT over its whole life, model-weighted — a different question from `depth`.
   *
   * `depth` is what one more turn will cost; this is what every turn already cost. A supervisor needs both:
   * a shallow session that has already burned a fortune and a deep session that has barely started are
   * opposite decisions, and the depth column alone cannot tell them apart.
   */
  readonly usage: Measured<SessionUsage>;
}

/** One session's whole-life usage, as `sessions/transcriptUsageStore.ts` folds it. */
export interface SessionUsage {
  readonly totals: UsageTotals;
  readonly byModel: readonly ModelUsageTotals[];
  readonly weighted: Measured<ModelWeightedUsage>;
  /** Lines skipped as already counted. Printed because it is roughly a third and reads as a fault unexplained. */
  readonly duplicates: number;
  /** Lines that mentioned usage and could not be read. Never silent — a dropped turn is missing spend. */
  readonly unreadable: number;
}

/** What the caller already resolved about the one session the fleet keeps alive on purpose. */
export interface StandingSessions {
  /** The loop's own working directory, resolved from its ledger key — `undefined` when the caller resolved none. */
  readonly loopCwd: string | undefined;
}

/** Whether this record is the standing session — the loop. */
function standingKindOf({
  record,
  standing,
}: {
  record: SessionRecord;
  standing: StandingSessions;
}): StandingKind | undefined {
  return standing.loopCwd !== undefined && record.cwd === standing.loopCwd ? "loop" : undefined;
}

/**
 * Build one row per live session, deepest first.
 *
 * @param records the live session registry, already scanned
 * @param depths each session's measured depth, keyed by session id — the caller reads the transcripts
 * @param workspaces the live cmux inventory
 * @param ledger the session ledger, already folded
 * @param standing what the caller resolved about the loop
 * @param thresholdTokens the depth at or past which a session is a respawn candidate
 * @param callerSessionId the calling session's own Claude Code session id, or `undefined` when it has none —
 *   nothing is then marked `self`, which is the honest answer rather than a guess
 * @returns one row per live session, deepest first, with unmeasurable depths last
 */
export function sessionDepthRows({
  records,
  depths,
  workspaces,
  ledger,
  standing,
  thresholdTokens,
  callerSessionId,
  usages = {},
}: {
  records: readonly SessionRecord[];
  depths: Readonly<Record<string, Measured<ContextDepth>>>;
  workspaces: readonly CmuxWorkspaceSummary[];
  ledger: readonly SessionItem[];
  standing: StandingSessions;
  thresholdTokens: number;
  callerSessionId: string | undefined;
  usages?: Readonly<Record<string, Measured<SessionUsage>>>;
}): readonly SessionDepthRow[] {
  // A directory is shared once a second session is seen in it, so sharing is a set rather than a count.
  const seenCwds = new Set<string>();
  const sharedCwds = new Set<string>();
  for (const record of records) {
    const { cwd } = record;
    if (seenCwds.has(cwd)) {
      sharedCwds.add(cwd);
    }
    seenCwds.add(cwd);
  }
  const rows = records.map((record): SessionDepthRow => {
    const workspace = workspaces.find((candidate) => candidate.currentDirectory === record.cwd);
    const tracked = ledger.find((item) => item.status === "open" && item.cwd === record.cwd);
    const { [record.sessionId]: depth = unmeasurable<ContextDepth>({ why: "the transcript was not read this call" }) } =
      depths;
    const {
      [record.sessionId]: usage = unmeasurable<SessionUsage>({ why: "the transcript was not folded this call" }),
    } = usages;
    return {
      cwd: record.cwd,
      cwdShared: sharedCwds.has(record.cwd),
      depth,
      pid: record.pid,
      self: callerSessionId !== undefined && record.sessionId === callerSessionId,
      sessionId: record.sessionId,
      sessionKey: tracked?.sessionKey,
      slug: tracked?.slug,
      standing: standingKindOf({ record, standing }),
      title: workspace?.title,
      usage,
      verdict: depth.known
        ? measured({ value: depthVerdict({ depthTokens: depth.value.depthTokens, thresholdTokens }) })
        : depth,
      workspaceRef: workspace?.workspaceRef,
    };
  });
  return rows.toSorted((left, right) => depthOrZero({ row: right }) - depthOrZero({ row: left }));
}

/** A row's depth for sorting only — an unmeasurable depth sorts last rather than pretending to be shallow. */
function depthOrZero({ row }: { row: SessionDepthRow }): number {
  return row.depth.known ? row.depth.value.depthTokens : -1;
}

/** What a row is called: its workspace title, else its ledger key, else its workspace ref, else its cwd. */
function rowName({ row }: { row: SessionDepthRow }): string {
  if (row.title !== undefined) {
    return row.title;
  }
  if (row.sessionKey !== undefined) {
    return row.sessionKey;
  }
  if (row.workspaceRef !== undefined) {
    return row.workspaceRef;
  }
  return row.cwd;
}

/**
 * One row as the line a supervisor reads.
 *
 * @param row the row to render
 * @returns the human-readable line
 */
export function renderSessionDepthRow({ row }: { row: SessionDepthRow }): string {
  const name = rowName({ row });
  const depth = row.depth.known
    ? `${compactTokens({ count: row.depth.value.depthTokens })} deep on ${row.depth.value.model}`
    : `depth NOT MEASURED — ${row.depth.why}`;
  const marks = [
    row.verdict.known ? row.verdict.value : "no-verdict",
    ...(row.self ? ["self"] : []),
    ...(row.standing === undefined ? [] : [`standing:${row.standing}`]),
    ...(row.cwdShared ? ["cwd-shared"] : []),
  ];
  return `${marks.join(" ")}\t${name}\t${depth}\tpid ${String(row.pid)}`;
}
