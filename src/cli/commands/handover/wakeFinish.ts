/**
 * A due park on a MERGED pull request whose run has only its finish left settles WITHOUT a reseat.
 *
 * MEASURED on a live board: 19 of the 41 due parks were
 * checks wakes whose pull request already read MERGED. Each one's reseat boots a whole seat to run
 * `handover finish`, and every such boot was one of the run's three, so the merged rows held the attempts the
 * live ones needed.
 *
 * So before spending a boot on a merged park, the wake runs the REAL `slopweaver handover finish <slug>` as a
 * bounded child. "Only its finish left" is never inferred here: it is exactly the case every one of finish's own
 * gates passes — no open question, the lesson question already answered, every raised pull request's checks read,
 * every page carded, every probe met. The child inherits no `SLOPWEAVER_ALLOW_*` variable, so no hatch the
 * caller's environment opened forces one of those gates on the wake's behalf; the one variable the wake itself sets
 * is the lessons break-glass, on a park the reconcile classed `landed` alone ({@link wakeFinishEnv}) — MEASURED
 * on a live board, every finish this module asked over the live board refused on that gate and nothing else, because a
 * seat that parked on its own landing closed before answering it. It stands in the parked seat's own
 * recorded worktree, never the tick's checkout: finish resolves its probes against the tree it is run from
 * (`../../../handover/probeCheckout.ts`), and the supervisor's tree knows nothing of the parked branch; a worktree already removed puts it in the state home, so the doc's own repo answers, as it does from
 * a path left that is no linked worktree of it — and either is asked only once that repo holds the merge commit on a
 * clean tree ({@link finishCwd}); `--probed-repo` and `--probed-tree` bind the child to the repo and tree this wake
 * proved, so a doc or path that moved meanwhile refuses rather than probing elsewhere. It carries `--park-index` and
 * `--parked-at`, so its `finished` append closes the
 * run only while THIS park still stands — a reseat and re-park landing while it runs is another park, even at the
 * same instant. Without `--probe` a `command:` probe reads not-evaluated, as on any
 * finish run without it — the finish's own gates decide whether that closes the run. A parked run is released, so
 * finish reaches those gates at all only through `../../../handover/parkedFinish.ts`. An exit 0 the journal bears out
 * closes the run, which ends the park; any other ending — a gate refusing, a store outage, a timeout, or an exit 0
 * the journal does NOT bear out — means only that the finish did not happen, and the row falls through to the
 * reseat it always had, its row naming whatever finish printed on stderr ({@link finishStderrDetail}) — MEASURED
 * on a live board: six rows read only "ended exit 1" while finish had printed its open-question refusal.
 * That reseat re-reads the park first, so a park something else cleared is never reseated
 * beside, and a park still standing is never held forever on a finish that keeps not closing it. A dry run asks `handover finish --dry-run`, which runs every gate and writes nothing.
 *
 * A run asks at most {@link WAKE_FINISH_ASKS} times, each on a {@link WAKE_FINISH_TIMEOUT_MS} budget, so the tick's
 * wake reading stays bounded (`../../../supervisor/scratch/tickCapture.ts` derives its budget from both); a merged
 * park past that count goes straight to the reseat path, as before this module. The asks go longest since the last
 * ask — or since due, never asked — first (`../../../handover/wakeOrder.ts`'s `leastRecentlyTried`, over
 * `../../../handover/wakeTurnStore.ts`), so parks whose finish keeps refusing take turns with the rest instead of
 * every ask on every tick. The ask runs
 * under the park's wake claim (`./wakeDueFinish.ts`), so it never runs beside another wake's reseat of the same park.
 */
import { isAbsolute } from "node:path";

import { collapseWhitespace } from "#lib/oneLineSummary.js";

import type { ParkWakeJudgement } from "../../../handover/parkWake.js";
import { finishUnproven } from "../../../handover/wakeProofs.js";
import { ALLOW_NO_LESSONS } from "../../../knowledge/declared.js";
import { describeChildOutcome } from "../../../supervisor/scratch/childOutcome.js";
import type { BoundedChildWithStderr } from "../supervisor/scratchChild.js";
import { docRepoUnproven } from "./wakeMergeProof.js";
import type { HandoverWakeDeps } from "./wakeRows.js";

/** One `handover finish` child's budget: every gate, probes included, on a run that has nothing else left. */
export const WAKE_FINISH_TIMEOUT_MS = 60_000;

/**
 * The most `handover finish` children one run launches. A judgement, not a measurement: 19 merged parks stood due
 * on a live board, and six a tick clears that backlog in four ticks while adding at most six minutes to the reading.
 */
export const WAKE_FINISH_ASKS = 6;

/**
 * The reconcile's read of a parked worktree's branch, one per finish ask. `git branch --show-current` is a local
 * read of `HEAD`; the git runner's two-minute default is for reads that walk history, and six of those would
 * outgrow the tick's wake budget (r1 review of this change).
 */
export const WAKE_BRANCH_READ_TIMEOUT_MS = 10_000;

/**
 * The most of a finish child's stderr a row carries. A judgement, not a measurement: an ordinary gate's refusal — the
 * open-question one is under 400 bytes — fits many times over, and the cap keeps one row bounded when a child prints
 * without end until its budget is spent. A cut is named in the row (see {@link finishStderrDetail}).
 */
export const WAKE_FINISH_STDERR_MAX_BYTES = 64 * 1024;

/** The prefix every override variable carries, none of which the wake's finish child inherits. */
const HATCH_ENV_PREFIX = "SLOPWEAVER_ALLOW_";

/**
 * An environment with every `SLOPWEAVER_ALLOW_*` variable removed, so a finish the wake runs passes on its own
 * gates or not at all.
 *
 * @param env the environment the caller would otherwise hand the child
 * @returns a copy carrying no override variable
 */
export function hatchFreeEnv({ env }: { env: NodeJS.ProcessEnv }): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith(HATCH_ENV_PREFIX)));
}

/**
 * The finish child's environment: {@link hatchFreeEnv} always, and then — only for a park the reconcile classed
 * `landed` (`../../../handover/parkedLanding.ts`) — `SLOPWEAVER_ALLOW_NO_LESSONS=1` and nothing else.
 *
 * Why that one gate, for that one class: the lesson question is asked "while the run's own context still exists"
 * (`../../../knowledge/declared.ts`), and a landed row's context-holding seat closed itself on the park before
 * answering. A reseat holds no more of that context than the wake does — it would mine the transcript or type
 * `--lessons none` — so it spends a seat boot to say the same thing. The break-glass is the designed loud path: it
 * journals `lessons` with `forced: true`, so every such run reads as UNANSWERED rather than as "nothing learned",
 * and no live seat can reach it through this verb — the variable is set here, by the wake, on a child the caller's
 * own environment never reaches. Every other gate finish runs still decides the row, and decides it FIRST: finish
 * journals a forced answer only after its own `finished` append succeeded (`./finishUnderLock.ts`), so a run any
 * gate refuses keeps its question.
 *
 * @param env the environment the caller would otherwise hand the child
 * @param allowNoLessons whether the park was classed `landed`
 * @returns a copy carrying no override variable but, when allowed, the lessons one
 */
export function wakeFinishEnv({
  allowNoLessons,
  env,
}: {
  allowNoLessons: boolean;
  env: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const free = hatchFreeEnv({ env });
  if (!allowNoLessons) {
    return free;
  }
  return { ...free, [ALLOW_NO_LESSONS]: "1" };
}

/**
 * Whether a judgement is a checks wake whose pull request merged — the one park the wake asks `finish` about.
 *
 * @param judgement the park's wake judgement
 * @returns true for a due checks wake observed MERGED
 */
export function mergedPark({ judgement }: { judgement: ParkWakeJudgement }): boolean {
  return judgement.kind === "due" && judgement.observed.kind === "checks" && judgement.observed.prState === "MERGED";
}

/**
 * Where the finish child stands: the parked seat's own worktree while it exists, else the state home.
 *
 * MEASURED on a live `handover wake --dry-run`: merged parks whose worktree was already removed failed
 * to launch at all (`spawnSync … ENOENT`) and fell to a reseat, which is the boot this module exists to save. The
 * state home is no checkout, so finish's probes resolve against the doc's own `repo:`
 * (`../../../handover/probeCheckout.ts`), which is where a MERGED pull request's change now lives — never the
 * tick's own worktree, the wrong tree.
 *
 * That checkout is only as fresh as its last pull and as clean as its last edit, and nothing here fetches. So the child is asked there only once its `HEAD` holds the very merge commit GitHub reported on
 * a clean tree (`./wakeMergeProof.ts`); short of that the row falls through to the reseat it always had. A trunk
 * commit after the merge is no different from one landing after a reseated seat's own finish.
 *
 * @param worktree the parked seat's recorded checkout
 * @param worktreeExists whether that checkout is still on disk
 * @returns the directory the child runs in
 */
export function finishCwd({
  home,
  worktree,
  worktreeExists,
}: {
  home: string;
  worktree: string;
  worktreeExists: boolean;
}): string {
  if (worktreeExists) {
    return worktree;
  }
  return home;
}

/**
 * What one finish ask came to: the run closed (or would have, on a dry run), or the sentence a reseat carries and
 * whether a child was launched at all — a tree not proven to hold the merge launches none, and spends no ask.
 */
export type WakeFinishOutcome =
  | { readonly kind: "finished"; readonly detail: string }
  | { readonly kind: "not-finished"; readonly why: string; readonly launched: boolean };

/**
 * A finish the wake never launched, because the tree its probes would read is not proven: no ask is spent.
 *
 * @param reason the judgement's own sentence
 * @param unproven why the tree is not proven
 * @returns the not-finished outcome its reseat carries
 */
function notAsked({ reason, unproven }: { reason: string; unproven: string }): WakeFinishOutcome {
  return { kind: "not-finished", launched: false, why: `${reason}, but ${unproven}, so handover finish was not asked` };
}

/**
 * The doc's `repo:` once it can be trusted as the tree a finish's probes read: named, absolute, and — when the
 * probes would read it — proven to hold the merge on a clean tree; else why not.
 */
function provenDocRepo({
  docRepo,
  mergeCommitOid,
  mergeProof,
  probesDocRepo,
}: {
  docRepo: string | undefined;
  mergeCommitOid: string | undefined;
  mergeProof: HandoverWakeDeps["mergeProof"];
  probesDocRepo: boolean;
}): { readonly kind: "proven"; readonly docRepo: string } | { readonly kind: "unproven"; readonly unproven: string } {
  if (docRepo === undefined) {
    return { kind: "unproven", unproven: "its doc names no repo: to prove its probes' tree against" };
  }
  // A relative repo: resolves against the wake's cwd here and the child's there.
  if (!isAbsolute(docRepo)) {
    return {
      kind: "unproven",
      unproven: `its doc's repo: ${docRepo} is relative, so the wake and finish would read it from different directories`,
    };
  }
  const unprovenTree = probesDocRepo ? docRepoUnproven({ docRepo, mergeCommitOid, mergeProof }) : undefined;
  if (unprovenTree !== undefined) {
    return { kind: "unproven", unproven: unprovenTree };
  }
  return { docRepo, kind: "proven" };
}

/**
 * Ask the real `handover finish` to close a merged park's run, and say what it came to. A real exit 0 is believed
 * only when the first line to clear THIS park is `finished`; a dry run writes nothing, so its exit 0 is the answer.
 *
 * @param finish runs `handover finish <slug>` — with `--dry-run` when asked — as a bounded child
 * @param parkIndex the park's position in the journal, which the child's append and the proof after both bind to
 * @param reason the judgement's own sentence, naming the merged pull request
 * @param worktree the parked seat's recorded checkout, which the child stands in so its probes read that tree
 * @param worktreeExists whether that checkout is still on disk; once removed — a merged pull request's usual fate —
 *   the child stands in the state home instead (see {@link finishCwd})
 * @param probesDocRepo whether the child's probes would read the doc's own `repo:` — always once the worktree is
 *   gone, and from a path that is no linked worktree of it — which it is asked over only once that repo proves the
 *   merge on a clean tree (`./wakeMergeProof.ts`); a doc naming no repo, or a relative one, proves nothing and is
 *   never asked
 * @param parkedAtIso the park's own instant, which binds the child's `finished` append to this park alone
 * @param allowNoLessons whether the child may force past the lesson question — a `landed` park only
 *   ({@link wakeFinishEnv})
 * @param besideQuestion whether a dry run sets the run's open question aside, asking whether the owner's answer is
 *   all the run still waits on (the question pass, `./wakeDueFinish.ts`'s `finishReadyBesideQuestion`)
 * @returns `finished` on a proven exit 0, else why the row still goes to its reseat — an exit 0 the journal does not
 *   show included
 */
export async function finishMergedPark({
  allowNoLessons,
  besideQuestion,
  docRepo,
  dryRun,
  finish,
  home,
  mergeCommitOid,
  mergeProof,
  parkIndex,
  parkedAtIso,
  probesDocRepo,
  reason,
  runsDir,
  slug,
  worktree,
  worktreeExists,
}: {
  allowNoLessons: boolean;
  besideQuestion: boolean;
  docRepo: string | undefined;
  dryRun: boolean;
  finish: HandoverWakeDeps["finish"];
  home: string;
  mergeCommitOid: string | undefined;
  mergeProof: HandoverWakeDeps["mergeProof"];
  parkIndex: number;
  parkedAtIso: string;
  probesDocRepo: boolean;
  reason: string;
  runsDir: string;
  slug: string;
  worktree: string;
  worktreeExists: boolean;
}): Promise<WakeFinishOutcome> {
  const repo = provenDocRepo({ docRepo, mergeCommitOid, mergeProof, probesDocRepo });
  if (repo.kind === "unproven") {
    return notAsked({ reason, unproven: repo.unproven });
  }
  const cwd = finishCwd({ home, worktree, worktreeExists });
  const child = await finish({
    allowNoLessons,
    besideQuestion,
    cwd,
    dryRun,
    home,
    parkIndex,
    parkedAtIso,
    probedRepo: repo.docRepo,
    probedTree: probesDocRepo ? "doc-repo" : "session-worktree",
    slug,
    timeoutMs: WAKE_FINISH_TIMEOUT_MS,
  });
  return launchedOutcome({ child, dryRun, parkIndex, reason, runsDir, slug });
}

/**
 * What a finish child printed on stderr, on one line, for the row that says why it did not close the run: every
 * character kept, whitespace collapsed so the text report stays one line per row, and a cut at the cap named.
 *
 * @param stderr the text kept
 * @param stderrBytes how many bytes the child wrote in all
 * @param stderrKeptBytes how many raw bytes the text was decoded from — never the text re-encoded
 * @param stderrTruncated whether the text is a prefix
 * @returns the one-line refusal, or `undefined` when the child printed nothing
 */
function finishStderrDetail({
  stderr,
  stderrBytes,
  stderrKeptBytes,
  stderrTruncated,
}: {
  stderr: string;
  stderrBytes: number;
  stderrKeptBytes: number;
  stderrTruncated: boolean;
}): string | undefined {
  if (stderrBytes === 0) {
    return undefined;
  }
  const kept = stderrKeptBytes;
  const text = collapseWhitespace({ text: stderr });
  const parts: string[] = [];
  if (text !== "") {
    parts.push(text);
  } else if (kept > 0) {
    // Collapsing would leave nothing at all, which reads as a child that printed nothing.
    parts.push(`[${String(kept)} stderr byte(s), all whitespace]`);
  }
  if (stderrTruncated) {
    parts.push(`… [cut: the first ${String(kept)} of ${String(stderrBytes)} stderr bytes kept]`);
  }
  return parts.join(" ");
}

/**
 * What a launched finish child came to: a believed close, or why the row still goes to its reseat — naming the
 * refusal the child printed, when it printed one.
 *
 * @param child how the child ended, and what it printed on stderr
 * @param reason the judgement's own sentence, naming the merged pull request
 * @returns `finished` on an exit 0 the journal bears out (any exit 0 on a dry run), else `not-finished`
 */
function launchedOutcome({
  child,
  dryRun,
  parkIndex,
  reason,
  runsDir,
  slug,
}: {
  child: BoundedChildWithStderr;
  dryRun: boolean;
  parkIndex: number;
  reason: string;
  runsDir: string;
  slug: string;
}): WakeFinishOutcome {
  const { outcome } = child;
  const printed = finishStderrDetail(child);
  const said = printed === undefined ? "" : ` (${printed})`;
  if (outcome.kind !== "exited" || outcome.exitCode !== 0) {
    // A silent failure is said to be silent, so the row never carries an exit code alone.
    let failureSaid = said;
    if (printed === undefined) {
      failureSaid = " (it printed nothing on stderr)";
    }
    return {
      kind: "not-finished",
      launched: true,
      why: `${reason}, but handover finish ended ${describeChildOutcome({ outcome })}${failureSaid}, so it did not close the run`,
    };
  }
  if (dryRun) {
    return {
      // A dry run closes nothing, so a warning it printed is still worth reading.
      detail: `would settle without a reseat: ${reason}, and handover finish --dry-run passed${said}`,
      kind: "finished",
    };
  }
  const unproven = finishUnproven({ parkIndex, runsDir, slug });
  if (unproven !== undefined) {
    // What it printed rides here too: an exit 0 the journal does not bear out is not a close either.
    return { kind: "not-finished", launched: true, why: `${reason}; ${unproven}${said}` };
  }
  return { detail: `settled without a reseat: ${reason}, and handover finish closed the run`, kind: "finished" };
}
