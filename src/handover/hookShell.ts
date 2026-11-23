/**
 * The effectful half of the run hooks: find the runs on disk, and emit the JSON Claude Code expects.
 *
 * ## The output contract, read off the harness rather than assumed
 *
 * A hook returns JSON on stdout. Two shapes matter here, and both are the harness's own documented fields:
 *
 *   {"decision":"block","reason":"…"}                                        // refuse a Stop
 *   {"hookSpecificOutput":{"hookEventName":"…","additionalContext":"…"}}     // inject context
 *
 * `Stop` fires when Claude stops — including on clear, resume and compact — which is exactly why the gate must
 * be bounded: it is reached far more often than "the agent gave up mid-run".
 *
 * ## Probe state is RE-CHECKED here, and the old shortcut was a measured lie
 *
 * This module used to report the last probe snapshot the journal recorded, labelled "unverified", on the grounds
 * that a hook must be fast. Measured: that number was wrong every single time it was hand-checked
 * against the worktree — 6 unmet against a truth of 2 passing, then 3, then all 6 — and it was being presented
 * as the reason to block a turn. A labelled wrong number is still a wrong number, and this is the repo's own
 * named failure class.
 *
 * So probes are re-evaluated at gate time. They are file-and-substring reads costing milliseconds, and the work
 * is bounded exactly as the git calls are: only an `open`, unambiguous run is worth evaluating at all, because
 * nothing else can block, and no more than {@link MAX_BRANCH_LOOKUPS} of those are looked at. `command:` probes
 * are declined here as everywhere but `--probe`, so no doc's shell runs from a hook.
 */

import { execFileSync } from "node:child_process";
import { gitEnv } from "#lib/gitRepo.js";
import type { CodexThreadObservation } from "../measurement/codexSessions.js";
import { DEFAULT_CLAIM_STALE_MS, runClaimFor } from "../measurement/overlap.js";
import type { Measured } from "../measurement/status.js";
import { settledAskOf } from "./askRow.js";
import type { HandoverDoc } from "./doc.js";
import { lastGateObservation, NOTHING_CHECKED, type ProbeTally, progressSince, recheckTally } from "./gateReport.js";
import type { OpenRun } from "./hookGate.js";
import type { JournalSkipSummary } from "./hookJournalRank.js";
import { journalReadBuffer, readJournalBounded, selectHookJournals } from "./hookJournalScan.js";
import { type ParsedLedger, runStateOf } from "./ledger.js";
import type { ProbeResult } from "./probe.js";
import { planReap, reapCandidateOf } from "./reap.js";
import { applyRowEvent } from "./rowEvent.js";
import { runOwnership } from "./runOwner.js";
import { classifyWriterLiveness } from "./writerLiveness.js";

/**
 * The most branch lookups one hook invocation will perform.
 *
 * The hook's configured deadline is 10 seconds, and an outer cancellation happens ABOVE the wrapper script, so
 * it bypasses the wrapper's guaranteed-zero exit — meaning a slow hook is NOT fail-open. An adversarial pass
 * found that: enough journals, each costing a git call, and the deadline is exceeded. So the work is bounded
 * twice over — only `open` runs are looked up at all (nothing else can block), and no more than this many.
 *
 * A run beyond the cap is reported as NOT resolving, which disarms the gate for it. Erring that way is the
 * standing rule here: the gate may only block on state it actually verified.
 */
const MAX_BRANCH_LOOKUPS = 4;

/** One hook invocation's runs, and how much of the runs directory it did NOT examine. */
export interface HookRunScan {
  readonly runs: readonly OpenRun[];
  /** What the journal pre-pass left out — stated by the brief and the refusal, never silently dropped. */
  readonly journals: JournalSkipSummary;
}

/** The edges {@link runsOnDisk} needs, injected so every rule above is testable without a repository. */
export interface RunScanSeams {
  /**
   * The branch's current head, or `undefined` when it does not resolve.
   *
   * One seam rather than two, because "does this branch exist?" and "has it gained a commit?" are the same git
   * call. `undefined` is what disarms the gate for a stale run, and it is also what stops a progress comparison
   * being made against a git failure.
   */
  readonly branchHead: (args: { repo: string; branch: string }) => string | undefined;
  /** Evaluates a doc's probes NOW. Returns an empty list when there is nothing it could resolve. */
  readonly evaluate: (args: { doc: HandoverDoc }) => readonly ProbeResult[];
  /** This session's id, so a run held by another session can be recognised as one. */
  readonly sessionId: string | undefined;
  /**
   * Every identity `handover reap` would resolve for ITSELF, which is not always {@link RunScanSeams.sessionId}.
   *
   * The hook prefers the harness's payload because that names the session being gated; the reaper reads the
   * environment, and takes EVERY id there (`../handover/runOwner.ts`'s `currentSessionIds`). Measured twice by
   * adversarial review passes: with a payload id of `A` beside an environment naming `B`, a brief judging
   * reapability by the payload alone promises an ending over `B`'s own run while the reap treats `B` as itself
   * and writes nothing — and an environment naming both a Claude session and a Codex thread has TWO such ids,
   * so carrying one of them reopened the same gap one layer down.
   */
  readonly commandSessionIds: readonly string[];
  /** The instant a claim's age is measured against. Injected, so claim expiry is testable without waiting. */
  readonly nowMs: number;
  /**
   * Whether a SESSION is still running — one small directory read, well inside the hook's deadline.
   *
   * Keyed on the session rather than a recorded pid, because the pid on a journal line belongs to whichever
   * process wrote it. See {@link ../measurement/sessions}.
   */
  readonly sessionLive: (args: { sessionId: string }) => Measured<boolean>;
  /**
   * Whether an OS pid is alive — one synchronous signal-0 probe, consulted ONLY for a hostless legacy
   * journal's writer (a host-labelled writer is judged by `sessionLive` or `codexThread`).
   */
  readonly processAlive: (args: { pid: number }) => boolean;
  /**
   * What Codex's open files say about a Codex writer's thread — one `lsof`, taken lazily and at most once, so a
   * scan judging no Codex writer never pays for it. See {@link ../measurement/codexSessions}.
   */
  readonly codexThread: (args: { threadId: string }) => CodexThreadObservation;
}

/**
 * Read every run on disk into the shape the pure gate consumes, re-checking probes as it goes.
 *
 * @param runsDir where journals live
 * @param docs the board, so a run can be matched to its repository
 * @param boardPartial whether the board scan failed or skipped unreadable docs — doc counts are then guesses
 * @param seams the git, probe and identity edges
 * @returns one entry per journal examined — the runs this session holds first, then the most recently written,
 *   up to the cap (`./hookJournalScan.ts`) — and the count of journals left out
 */
export function runsOnDisk({
  runsDir,
  docs,
  boardPartial,
  seams,
}: {
  runsDir: string;
  docs: readonly HandoverDoc[];
  boardPartial: boolean;
  seams: RunScanSeams;
}): HookRunScan {
  const selection = selectHookJournals({ runsDir, sessionId: seams.sessionId });
  const runs: OpenRun[] = [];
  let lookups = 0;
  let grewPastBound = 0;
  // One bounded buffer for every read, never a whole-file read: a journal appended to after the pre-pass measured
  // it fills the buffer's extra byte and is counted, rather than read without bound (r1 review).
  const buffer = journalReadBuffer();
  for (const slug of selection.slugs) {
    const journal = readJournalBounded({ buffer, runsDir, slug });
    if (journal === undefined) {
      // Grown past the bound or unreadable: skipped rather than guessed at, and counted. The gate errs toward
      // allowing a stop, and a run nobody can read is not evidence that work is in flight.
      grewPastBound += 1;
      continue;
    }
    const examined = examineJournal({
      boardPartial,
      docs,
      journal,
      lookupsLeft: lookups < MAX_BRANCH_LOOKUPS,
      seams,
      slug,
    });
    if (examined.looked) {
      lookups += 1;
    }
    runs.push(examined.run);
  }
  const journals = {
    ...selection.summary,
    skippedUnavailable: selection.summary.skippedUnavailable + grewPastBound,
  };
  return { journals, runs };
}

/** One read journal judged against the board: its run, and whether it spent one of the branch lookups. */
function examineJournal({
  boardPartial,
  docs,
  journal,
  lookupsLeft,
  seams,
  slug,
}: {
  boardPartial: boolean;
  docs: readonly HandoverDoc[];
  journal: Parameters<typeof scanOne>[0]["journal"];
  lookupsLeft: boolean;
  seams: RunScanSeams;
  slug: string;
}): { run: OpenRun; looked: boolean } {
  const state = runStateOf({ events: journal.events });
  // EXACTLY one owner, never `find`. Two docs claiming one slug is the case that made this gate unescapable:
  // `find` picked the first arbitrarily and the gate blocked on it, while `ask`, `finish`, `abandon` and
  // `resume` all REFUSE a duplicate slug outright — so every advertised escape failed and the run blocked
  // again on the next turn. Found by an adversarial review pass and reproduced before fixing.
  const owners = docs.filter((candidate) => candidate.slug === slug);
  const doc = owners.length === 1 ? owners[0] : undefined;
  const docClaim = docClaimOf({ boardPartial, owners });
  // Only an `open` run can block, so only an `open` run is worth a git call OR a probe re-check. A closed or
  // waiting run is allowed through regardless of what its branch says, so examining it would spend the
  // deadline for nothing.
  // A journal with lines nobody could decode is AMBIGUOUS, and the standing rule is that the gate may only
  // block on state it actually verified. An undecodable line could be the very `finished` or `question` that
  // closed this run, so deriving "open" from the lines that did parse is a guess. Found by an adversarial pass.
  const ambiguous = journal.unreadable.length > 0;
  const worthLooking = state.phase === "open" && !ambiguous && lookupsLeft;
  const run = scanOne({ branch: state.branch, doc, docClaim, journal, phase: state.phase, seams, slug, worthLooking });
  return { looked: worthLooking, run };
}

/** How many docs claim a slug, as guidance state: claim needs exactly one; a duplicate defeats every verb. */
function docClaimOf({
  owners,
  boardPartial,
}: {
  owners: readonly HandoverDoc[];
  boardPartial: boolean;
}): OpenRun["docClaim"] {
  // A PARTIAL board scan (unreadable or oversized doc files were skipped) poisons every count-based
  // conclusion: a skipped doc could be the one that claims this slug, or a second claimant. An r1 review pass
  // found "none" being derived — and an orphan abandon recommended — from exactly that state.
  if (boardPartial) {
    return "unknown";
  }
  if (owners.length === 1) {
    return "one";
  }
  return owners.length === 0 ? "none" : "duplicate";
}

/** The owning row's settlement as the brief carries it, or `undefined` for an unsettled or unowned slug. */
function settledOf({ doc }: { doc: HandoverDoc | undefined }): OpenRun["settled"] {
  return doc === undefined ? undefined : settledAskOf({ doc });
}

/**
 * Whether `handover reap` would close this cycle, asked of the REAPER rather than re-derived here.
 *
 * Only a settled row can render the line that consumes this, so only a settled row pays for the decision —
 * which costs one registry lookup against the roster the scan already read once.
 */
function reapableNow({
  journal,
  settled,
  seams,
  slug,
}: {
  journal: ParsedLedger;
  settled: OpenRun["settled"];
  seams: RunScanSeams;
  slug: string;
}): boolean {
  if (settled === undefined) {
    return false;
  }
  // EVERY identity is held: the hook's own (from the harness payload) and every one `handover reap` would
  // resolve from the environment. Any of them calling the writer live means the reap would skip the cycle, and
  // a brief promising an ending there would name a command that does nothing.
  const candidate = reapCandidateOf({
    codexThread: seams.codexThread,
    events: journal.events,
    processAlive: seams.processAlive,
    selfSessionIds: [seams.sessionId, ...seams.commandSessionIds].filter((id): id is string => id !== undefined),
    sessionLive: seams.sessionLive,
    slug,
    unreadableLines: journal.unreadable,
  });
  return candidate !== undefined && planReap({ candidates: [candidate] }).reapable.length === 1;
}

/**
 * What a run claims to be building, or `undefined` when no single doc owns its slug.
 *
 * Derived for EVERY run, not only the ones worth a git lookup: the claim is what the brief reports about a
 * neighbour, and a run held elsewhere is exactly the one this gate never looks at further.
 */
function claimOf({
  doc,
  journal,
  seams,
}: {
  doc: HandoverDoc | undefined;
  journal: ParsedLedger;
  seams: RunScanSeams;
}): OpenRun["claim"] {
  if (doc === undefined) {
    return undefined;
  }
  return runClaimFor({
    doc,
    journal,
    seams: { nowMs: seams.nowMs, sessionLive: seams.sessionLive, staleAfterMs: DEFAULT_CLAIM_STALE_MS },
  });
}

/** Assemble one run's entry: its head, its re-checked tally, its owner, and how far it has moved. */
function scanOne({
  slug,
  phase,
  branch,
  doc,
  docClaim,
  journal,
  seams,
  worthLooking,
}: {
  slug: string;
  phase: OpenRun["phase"];
  branch: string | undefined;
  doc: HandoverDoc | undefined;
  docClaim: OpenRun["docClaim"];
  journal: ParsedLedger;
  seams: RunScanSeams;
  worthLooking: boolean;
}): OpenRun {
  const events = journal.events;
  // A run this gate cannot UNAMBIGUOUSLY resolve — no branch recorded, no repo, or a slug claimed by more than
  // one doc — gets no head, which disarms it. The rule is that the gate may only block on a run whose typed
  // endings are known to work; anything else it reports and lets through.
  const resolvable = worthLooking && branch !== undefined && doc?.repo !== undefined;
  const head = resolvable ? seams.branchHead({ branch, repo: doc.repo }) : undefined;
  // Probes are re-checked only for a run that could actually block. Under the caps this is at most
  // MAX_BRANCH_LOOKUPS docs' worth of file reads, which is the bound the deadline needs.
  const tally: ProbeTally =
    worthLooking && doc !== undefined ? recheckTally({ results: seams.evaluate({ doc }) }) : NOTHING_CHECKED;
  const previous = lastGateObservation({ events });
  const ownership = runOwnership({ events, sessionId: seams.sessionId });
  return {
    branch,
    branchResolves: head !== undefined,
    claim: claimOf({ doc, journal, seams }),
    docClaim,
    head,
    journalAmbiguous: journal.unreadable.length > 0,
    ownership,
    phase,
    previous,
    progress: progressSince({ head, previous, tally }),
    reapable: reapableNow({ journal, seams, settled: settledOf({ doc }), slug }),
    settled: settledOf({ doc }),
    slug,
    tally,
    // An AMBIGUOUS journal (undecodable lines) derives no verdict: ownership read off the lines that did parse
    // is a guess, and `claim` refuses such a journal outright — so a dead-holder claim instruction rendered
    // from it would recommend a command that cannot succeed. Found by the r1 review pass.
    writerLiveness: journal.unreadable.length > 0 ? undefined : holderLiveness({ docClaim, ownership, phase, seams }),
  };
}

/**
 * The foreign holder's liveness, derived ONLY where the brief can use it.
 *
 * Only an open run held elsewhere can surface the stand-off line, so only that case pays for a verdict —
 * closed and waiting journals trigger neither a registry lookup nor a pid probe, keeping the hook's per-run
 * work inside its deadline.
 *
 * ACCEPTED RESIDUAL (r1 review, judged not fixed): a Stop event also derives these verdicts although only the
 * SessionStart/PostCompact brief renders them. The cost is a bounded in-memory Set lookup per open foreign
 * run against a roster the scan reads once regardless (runClaimFor consumes the same closure for every run on
 * both event kinds), so threading event-kind through the scan would buy nanoseconds at the price of a wider
 * seam. Revisit only if the hook ever gains per-run registry I/O.
 */
function holderLiveness({
  phase,
  ownership,
  docClaim,
  seams,
}: {
  phase: OpenRun["phase"];
  ownership: OpenRun["ownership"];
  docClaim: OpenRun["docClaim"];
  seams: RunScanSeams;
}): OpenRun["writerLiveness"] {
  // A duplicate slug renders its own no-command statement before liveness is ever read, so probing the
  // registry for one would be a measurement the guidance never consumes (r1).
  if (phase !== "open" || ownership.kind !== "elsewhere" || docClaim === "duplicate") {
    return undefined;
  }
  return classifyWriterLiveness({
    codexThread: seams.codexThread,
    processAlive: seams.processAlive,
    sessionLive: seams.sessionLive,
    writer: ownership.writer,
  });
}

/**
 * A branch's current head. The production seam for {@link RunScanSeams.branchHead}.
 *
 * @param repo the repository to ask
 * @param branch the branch name
 * @returns the head sha, or `undefined` for every failure — which disarms the gate rather than guessing
 */
export function branchHeadSha({ repo, branch }: { repo: string; branch: string }): string | undefined {
  try {
    const out = execFileSync("git", ["-C", repo, "rev-parse", "--verify", `refs/heads/${branch}`], {
      encoding: "utf8",
      env: gitEnv(),
      stdio: ["ignore", "pipe", "ignore"],
      // Well inside the hook's own deadline, even at the lookup cap: 4 × 1.5s leaves headroom in 10s.
      timeout: 1_500,
    }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Record what the gate saw, so the NEXT firing can lead with the difference.
 *
 * Two rules, both load-bearing. It is never called for a run held by another session — that is the cross-session
 * write this whole change exists to prevent — and its failure is swallowed, because a journal that cannot be
 * appended to must not become a gate that cannot be passed.
 *
 * @param runsDir where journals live
 * @param run the run as the gate just observed it
 * @param nowIso the timestamp to stamp
 * @param sessionId the session the gate fired in
 */
export function recordGateObservation({
  runsDir,
  run,
  nowIso,
  sessionId,
}: {
  runsDir: string;
  run: OpenRun;
  nowIso: string;
  sessionId: string | undefined;
}): void {
  void applyRowEvent({
    event: {
      atIso: nowIso,
      failed: run.tally.failed,
      head: run.head,
      kind: "gated",
      notEvaluated: run.tally.notEvaluated,
      passed: run.tally.passed,
      sessionId,
    },
    runsDir,
    slug: run.slug,
  });
}

/**
 * The JSON a hook prints to inject context, or `null` when there is nothing to say.
 *
 * @param event the hook event name, echoed back as the harness requires
 * @param lines the brief to inject
 * @returns the JSON line, or `null` to stay silent
 */
export function contextOutput({ event, lines }: { event: string; lines: readonly string[] }): string | null {
  if (lines.length === 0) {
    return null;
  }
  return JSON.stringify({
    hookSpecificOutput: { additionalContext: lines.join("\n"), hookEventName: event },
  });
}

/**
 * The JSON a `Stop` hook prints to refuse.
 *
 * @param lines the refusal, which must name every escape
 * @returns the JSON line
 */
export function blockOutput({ lines }: { lines: readonly string[] }): string {
  return JSON.stringify({ decision: "block", reason: lines.join("\n") });
}
