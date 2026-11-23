/**
 * What a BATCH lap decides, as pure functions: the ordered member list, the squash chain it simulates, the batch
 * note its statuses carry, the `base-moved` subjects a member's merge accepts and when it must not, and whether a
 * landed commit is the one the chain predicted. `./lapBatchPhases.ts` acts on them.
 *
 * ## Why one lap can stand for a whole batch
 *
 * A single lap requires its head to contain the base tip, so the squash GitHub makes IS the head's tree. A batch
 * cannot keep that for its second member onward: the first landing moves the base. So the lap SIMULATES the squash
 * chain locally instead — `s_0` is the base tip, and each `s_k` is a ONE-parent commit (a squash has one parent) on
 * `s_{k-1}` whose tree is `git merge-tree` of `s_{k-1}` and member k's head — and laps `s_n`'s tree once. One
 * parent matters: for heads that share no history above the base tip, the merge base GitHub computes for member k
 * against the real landed `M_{k-1}` is the one the simulation computed against `s_{k-1}`.
 *
 * ## What it proves, and what it leaves unproven
 *
 * The simulation is a PREDICTION of GitHub's squash, not a reproduction: GitHub does not document its merge
 * machinery, so rename detection, merge drivers and Git version can differ. So the lap reads every landing back
 * and stops the batch unless the new tip's one parent is the tip it expected and its tree is `T_k`
 * ({@link landedCommitFindings}): a disagreement lands at most ONE unpredicted commit, named in the stop line, and
 * that landing cannot be undone. The final tree `T_n` is the lapped one; the intermediate trees `T_1..T_{n-1}`
 * reach the base checked for SHAPE but never run, which is what any batching merge queue accepts. A red lap lands
 * nothing: bisecting it is left to the next invocation, a shorter ordered list, until real batches show how often
 * one is red.
 */

import { CODEX_LOOP_SUBJECT } from "../../../codex/landingGate.js";
import type { RevertedPath } from "../../../outbound/github/mergeGuard.js";
import { LAP_CONTEXTS, STATUS_DESCRIPTION_MAX } from "./lapCore.js";
import type { LapStatus } from "./lapStatuses.js";

/** One batch member as the preflight read it. */
export interface LapBatchMember {
  readonly number: number;
  readonly headSha: string;
  readonly baseRef: string;
  readonly state: string;
}

/**
 * Refusals about the batch's members, before any simulation: every member open, and every member targeting the
 * SAME base branch. A native-stack member targets the member below it, which is not where it lands; that shape is
 * GitHub's own route (`skills/github/reference/stack-merge.md`) and is refused here rather than guessed at.
 *
 * @param members the members, in landing order
 * @returns one complete sentence per refusal
 */
export function batchMemberRefusals({ members }: { members: readonly LapBatchMember[] }): readonly string[] {
  const refusals = members
    .filter((member) => member.state !== "open")
    .map((member) => `#${String(member.number)} is ${member.state}, so the batch cannot land it`);
  const bases = [...new Set(members.map((member) => member.baseRef))];
  if (bases.length > 1) {
    const each = members.map((member) => `#${String(member.number)} → ${member.baseRef}`).join(", ");
    refusals.push(
      `a batch lands on ONE base branch, and these members target ${String(bases.length)} (${each}); ` +
        "a native-stack member targeting the one below it lands through GitHub's stack route, not a batch lap",
    );
  }
  return refusals;
}

/**
 * How long a batch's preflight may run, every member's read, fetch, simulated squash and merge measurement
 * included, before it refuses to start another stage. Each git child already has its own kill; this bounds their SUM, which
 * is what spun a seven-member dry run for 57 minutes, when a member's merge measurement turned out to scale with base
 * history rather than with its diff. A stage already running is not interrupted: the check falls between
 * stages, so one long stage overshoots by its own length, and the refusal names it.
 */
export const LAP_BATCH_PREFLIGHT_DEADLINE_MS = 10 * 60_000;

/**
 * The refusal for a batch preflight that is past its deadline once `stage` finished, or `undefined` while it is
 * not. Checked between stages, so the stage named is the one that carried the preflight over the line.
 *
 * @param startedMs when the preflight began, in epoch milliseconds
 * @param nowMs the clock now, in epoch milliseconds
 * @param stage what the preflight was doing, as a phrase that follows "while"
 * @returns the refusal sentence, or `undefined` while time remains
 */
export function batchPreflightOverrun({
  startedMs,
  nowMs,
  stage,
}: {
  startedMs: number;
  nowMs: number;
  stage: string;
}): string | undefined {
  const elapsedMs = nowMs - startedMs;
  if (elapsedMs <= LAP_BATCH_PREFLIGHT_DEADLINE_MS) {
    return undefined;
  }
  const limit = String(LAP_BATCH_PREFLIGHT_DEADLINE_MS / 60_000);
  const took = String(Math.round(elapsedMs / 1000));
  return (
    `the batch preflight passed its ${limit}-minute deadline while ${stage} (${took}s in); nothing was posted ` +
    "or run and the machine's lock is released, so lap a shorter batch or land the members singly"
  );
}

/** One simulated squash: member k's head merged onto the previous link, recorded as a one-parent commit. */
export interface SquashLink {
  readonly number: number;
  readonly headSha: string;
  /** The tree a squash of this member onto the previous link produces. */
  readonly tree: string;
  /** The one-parent commit carrying `tree` on the previous link (or the base tip, for the first member). */
  readonly commit: string;
}

/**
 * The note every status a batch posts carries after its base, so a reader of one member's status sees it was
 * earned in combination. The members themselves are in the batch's `lap.json`: twelve numbers do not fit beside
 * a retry tail in GitHub's 140 characters, and a list cut short would name a batch that never ran.
 *
 * @param size how many members the lapped chain held
 * @returns the note, starting with a comma
 */
export function batchNote({ size }: { size: number }): string {
  return `, batch of ${String(size)}`;
}

/**
 * The statuses posted on the members a batch could not land after all — a landing refused, or a landed commit
 * the simulation did not predict — so a green earned in combination cannot later be landed alone by hand. Like
 * every batch status it opens `local lap batch`, never `local lap: `, so `--land-only` never reads one as a lap's
 * green.
 *
 * @param baseTip the base tip the batch was simulated over
 * @param why the one-line reason
 * @returns one `failure` per context
 */
export function batchStoppedStatuses({ baseTip, why }: { baseTip: string; why: string }): readonly LapStatus[] {
  const text = `local lap batch stopped over base ${baseTip.slice(0, 10)}: ${why}`;
  return LAP_CONTEXTS.map((context) => ({
    context,
    description: Array.from(text).slice(0, STATUS_DESCRIPTION_MAX).join(""),
    state: "failure" as const,
  }));
}

/**
 * What `github merge`'s guard measures for one member over the tip it lands on: the `base-moved` paths (base gained
 * them after the member forked and its head lacks them), every path the member's own diff changes, whether its
 * head already contains that tip (the base-freshness gate), and the paths whose content it would restore to one
 * that tip's history held earlier (the `reverts-main` finding).
 */
export interface MemberMergeFacts {
  readonly baseMoved: readonly string[];
  readonly headChanged: readonly string[];
  readonly headContainsTip: boolean;
  readonly reverted: readonly RevertedPath[];
}

/**
 * Why the batch stops BEFORE its lap when a member would restore older content: measured over the member's own
 * simulated link, so the history it is read against holds the base and every member before it, and a member
 * undoing an earlier member's change is caught here. `github merge` refuses the same `reverts-main` finding when
 * that member lands, and the batch never hands it an acknowledgement for one — so lapping on would test a chain
 * that cannot land past this member, and leave the members before it landed alone.
 *
 * @param number the member
 * @param reverted the paths it restores over its link, each with the commit that held that content
 * @returns the refusal, or `undefined` when the member restores nothing
 */
export function memberRevertRefusal({
  number,
  reverted,
}: {
  number: number;
  reverted: readonly RevertedPath[];
}): string | undefined {
  if (reverted.length === 0) {
    return undefined;
  }
  const restored = reverted.map((entry) => `${entry.path} (restores ${entry.restoresBaseCommit.slice(0, 10)})`);
  return (
    `#${String(number)} would restore content the base or a member before it once held, in ${restored.join(", ")}, ` +
    "which its merge refuses as reverts-main: rebase it over what it undoes, or lap it alone with --acknowledge <path> if the revert is meant"
  );
}

/**
 * Whether two path lists hold the same paths, compared element by element once sorted — never through a joined
 * string, where a path containing a comma, or one literally named `none`, would make two sets read alike.
 */
function samePaths({ left, right }: { left: readonly string[]; right: readonly string[] }): boolean {
  const a = [...new Set(left)].toSorted();
  const b = [...new Set(right)].toSorted();
  return a.length === b.length && a.every((path, at) => path === b[at]);
}

/** A path set as one sorted, comma-joined string for a reader, or `none` when it is empty; never compared. */
function pathList({ paths }: { paths: readonly string[] }): string {
  if (paths.length === 0) {
    return "none";
  }
  return [...paths].toSorted().join(",");
}

/**
 * Why the batch will NOT accept one member's `base-moved` findings on its behalf, which stops the batch before
 * that member's merge. Two reasons, both fail-closed:
 *
 * - the measurement against the REAL tip differs from the one against the simulated link it stands for, so the
 *   base is not the tree the lap tested;
 * - a `base-moved` path is one the member's own diff ALSO changes. `--acknowledge` accepts by subject, so naming
 *   it would silence that path's other finding too (an `unmentioned-deletion` of a path the base deleted and
 *   re-added after the fork) — a finding the lap never answered;
 * - a `base-moved` path git QUOTED (`log --name-only` quotes a control character even with `core.quotePath` off,
 *   while the member's `-z` diff never does), so it cannot be compared with the member's own paths;
 * - a `base-moved` path holding a comma, which `--acknowledge`'s comma-separated list cannot name exactly,
 *   or opening or ending in whitespace, which its parser trims into a different subject;
 * - a path the member changes that is spelled exactly as the freshness subject (a tracked file named
 *   `base-moved`), which that subject would also accept as a path finding — and likewise the
 *   `codex-loop-incomplete` subject, when the member's own `--codex-loop-incomplete` hands it that one;
 * - a `base-moved` path spelled `codex-loop-incomplete`, on ANY member, which as a subject would accept the Codex
 *   loop finding for a member never named by `--codex-loop-incomplete`.
 *
 * @param simulated the facts measured over the simulated link before the lap
 * @param actual the facts measured over the real tip immediately before the merge
 * @param number the member
 * @param freshnessSubject the subject the batch adds for the base-freshness gate
 * @param loopSubject the Codex loop subject, present only when this member's own acknowledgement names it
 * @returns one sentence per reason; empty when the batch may accept the member's `base-moved` findings
 */
export function memberAcknowledgementRefusals({
  simulated,
  actual,
  number,
  freshnessSubject,
  loopSubject,
}: {
  simulated: readonly string[];
  actual: MemberMergeFacts;
  number: number;
  freshnessSubject: string;
  loopSubject?: string;
}): readonly string[] {
  const member = `#${String(number)}`;
  const refusals: string[] = [];
  if (!samePaths({ left: simulated, right: actual.baseMoved })) {
    const expected = pathList({ paths: simulated });
    const measured = pathList({ paths: actual.baseMoved });
    refusals.push(
      `${member}'s base-moved paths over the real tip (${measured}) are not the ones over its simulated ` +
        `link (${expected}), so the base it would land on is not the tree the lap tested`,
    );
  }
  return [
    ...refusals,
    ...pathSpellingRefusals({ baseMoved: actual.baseMoved, member }),
    ...subjectCollisionRefusals({ actual, freshnessSubject, loopSubject, member }),
  ];
}

/** The `base-moved` paths `--acknowledge` cannot name exactly: git-quoted, whitespace-padded or comma-holding. */
function pathSpellingRefusals({ baseMoved, member }: { baseMoved: readonly string[]; member: string }): string[] {
  const refusals: string[] = [];
  const quoted = baseMoved.filter((path) => path.startsWith('"'));
  if (quoted.length > 0) {
    refusals.push(
      `${member}'s base-moved paths include ${quoted.join(", ")}, which git quoted, so the batch cannot compare ` +
        "it with the member's own unquoted paths: lap it alone",
    );
  }
  const padded = baseMoved.filter((path) => path !== path.trim());
  if (padded.length > 0) {
    refusals.push(
      `${member}'s base-moved paths include ${padded.map((path) => JSON.stringify(path)).join(", ")}, which ` +
        "--acknowledge trims into a different subject: lap it alone",
    );
  }
  const commas = baseMoved.filter((path) => path.includes(","));
  if (commas.length > 0) {
    refusals.push(
      `${member}'s base-moved paths include ${commas.join(" and ")}, which a comma-separated --acknowledge cannot ` +
        "name exactly: lap it alone",
    );
  }
  return refusals;
}

/** A subject the batch hands the member's merge that would also accept a finding the lap never answered. */
function subjectCollisionRefusals({
  actual,
  member,
  freshnessSubject,
  loopSubject,
}: {
  actual: MemberMergeFacts;
  member: string;
  freshnessSubject: string;
  loopSubject: string | undefined;
}): string[] {
  const refusals: string[] = [];
  const changed = new Set(actual.headChanged);
  const shared = actual.baseMoved.filter((path) => changed.has(path));
  if (shared.length > 0) {
    refusals.push(
      `${member} itself changes ${shared.join(", ")}, which its merge also reports as base-moved; accepting that ` +
        "subject would accept its other finding too, which the lap never answered",
    );
  }
  if (changed.has(freshnessSubject)) {
    refusals.push(
      `${member} itself changes a path named ${freshnessSubject}, which the freshness subject the batch adds would ` +
        "also accept as a path finding: lap it alone",
    );
  }
  if (actual.baseMoved.includes(CODEX_LOOP_SUBJECT)) {
    refusals.push(
      `${member}'s base-moved paths include one named ${CODEX_LOOP_SUBJECT}, which as a subject would also accept ` +
        "the Codex loop finding for a member that never acknowledged it: lap it alone",
    );
  }
  if (loopSubject !== undefined && changed.has(loopSubject)) {
    refusals.push(
      `${member} itself changes a path named ${loopSubject}, which its own Codex loop acknowledgement would also ` +
        "accept as a path finding: lap it alone",
    );
  }
  return refusals;
}

/**
 * The acknowledgement handed to one member's `github merge`: the member's `base-moved` paths, and the
 * base-freshness subject `base-moved` when its head does not contain the tip. Both say the same measured thing —
 * the member forked before what is now the base — and the lap tested the squash of every member onto that base, so
 * accepting them states what was proven rather than waving a finding through. A caller's `--acknowledge` never
 * reaches here: `./lapCore.ts` refuses it on a batch, since it would be handed to every member. The one caller
 * acknowledgement a batch carries is PER MEMBER: `loop`, this member's own `--codex-loop-incomplete`, adds the Codex
 * loop subject and its reason to THIS merge and no other. Any other finding still refuses, and
 * {@link memberAcknowledgementRefusals} has already stopped a member whose paths would accept more.
 *
 * @param facts what the guard measures for this member over the tip it lands on
 * @param freshnessSubject the subject `github merge --admin`'s base-freshness gate accepts
 * @param tested the simulated commit the lap tested
 * @param loop this member's own Codex loop acknowledgement, absent when it gave none
 * @returns the subjects and reason to pass, or `undefined` when there is nothing to accept
 */
export function memberAcknowledgement({
  facts,
  freshnessSubject,
  tested,
  loop,
}: {
  facts: MemberMergeFacts;
  freshnessSubject: string;
  tested: string;
  loop?: { readonly subject: string; readonly reason: string };
}): { readonly subjects: string; readonly reason: string } | undefined {
  const stale = facts.headContainsTip ? [] : [freshnessSubject];
  const moved = [...new Set([...facts.baseMoved, ...stale])];
  const reasons: string[] = [];
  if (moved.length > 0) {
    reasons.push(
      `the base moved past this head (${String(facts.baseMoved.length)} path(s) it never saw): a local batch lap ` +
        `tested ${tested.slice(0, 10)}, the simulated squash of every member onto the base, which holds each of them`,
    );
  }
  if (loop !== undefined) {
    reasons.push(`${loop.subject}: ${loop.reason}`);
  }
  const subjects = loop === undefined ? moved : [...new Set([...moved, loop.subject])];
  if (subjects.length === 0) {
    return undefined;
  }
  return { reason: reasons.join("; "), subjects: subjects.join(",") };
}

/** A commit as read back after a landing: its own sha, its parents and its tree. */
export interface LandedCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly tree: string;
}

/**
 * Why a landed commit is NOT the one the chain predicted, which stops the batch: its parent must be the tip the
 * lap expected (no other landing slipped in) and its tree must be the simulated `T_k` (GitHub's squash agreed with
 * `git merge-tree`).
 *
 * @param landed the base tip as read back after the merge
 * @param expectedParent the tip the member was landed onto
 * @param link the member's simulated squash
 * @returns one sentence per disagreement; empty when the landing is exactly the prediction
 */
export function landedCommitFindings({
  landed,
  expectedParent,
  link,
}: {
  landed: LandedCommit;
  expectedParent: string;
  link: SquashLink;
}): readonly string[] {
  const findings: string[] = [];
  const member = `#${String(link.number)}`;
  if (landed.parents.length !== 1 || landed.parents[0] !== expectedParent) {
    findings.push(
      `the base tip after ${member} is ${landed.sha.slice(0, 10)}, whose parent(s) ${landed.parents.map((p) => p.slice(0, 10)).join(", ")} ` +
        `are not the tip ${expectedParent.slice(0, 10)} it was landed onto, so another landing slipped in`,
    );
  }
  if (landed.tree !== link.tree) {
    findings.push(
      `${member} landed as tree ${landed.tree.slice(0, 10)}, not the simulated ${link.tree.slice(0, 10)}, so GitHub's ` +
        "squash disagreed with the lap's and the members after it were never tested over what is now the base",
    );
  }
  return findings;
}
