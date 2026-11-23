/**
 * Landing a green batch, member by member in order, each under its own hold through `github merge --admin`
 * exactly as a single lap lands (`./lapPhases.ts`'s `land`), with three things only a batch needs:
 *
 * - Before each merge, the `base-moved` findings the member's merge will raise over the REAL tip are measured by
 *   the guard's own code and held against the simulation's; the batch accepts them on the member's behalf only
 *   when they match and none is a path the member itself changes (`memberAcknowledgementRefusals`). A member's
 *   own `--codex-loop-incomplete` reason joins THAT member's acknowledgement only, never another's.
 * - After each merge, the new tip is read back: its one parent must be the tip the member landed onto and its tree
 *   the simulated one (`landedCommitFindings`), or the batch stops.
 * - On any stop, every member that did not land gets a FAILURE on both contexts, so a green earned in combination
 *   cannot be landed alone later by `--land-only` or by hand through the disciplined path. It is not a lock: an
 *   administrator can still merge past a red status outside Slopweaver.
 */

import { CODEX_LOOP_SUBJECT } from "../../../codex/landingGate.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { BASE_MOVED_ACK } from "./baseFreshnessCore.js";
import {
  batchStoppedStatuses,
  landedCommitFindings,
  memberAcknowledgement,
  memberAcknowledgementRefusals,
} from "./lapBatchCore.js";
import { type BatchMember, type LapBatch, memberSession } from "./lapBatchPhases.js";
import type { LapSession } from "./lapDeps.js";
import { diagnose, land, post } from "./lapPhases.js";

/** One member's landing: the tip it now leaves the base at, or why the batch stops (and whether it landed first). */
type MemberLanding =
  | { readonly kind: "landed"; readonly tip: string }
  | { readonly kind: "stopped"; readonly landed: boolean; readonly why: readonly string[] };

/**
 * Why the member as GitHub now reads it is not the one the lap tested, or `undefined` when it still is: still
 * open, its head still the simulated one, and still targeting the batch's base branch. `land`'s refetch reads the
 * base BY NAME, so a pull request retargeted after the lap would otherwise be merged onto a branch never tested.
 */
async function memberMoved({
  session,
  batch,
  member,
  label,
}: {
  session: LapSession;
  batch: LapBatch;
  member: BatchMember;
  label: string;
}): Promise<string | undefined> {
  const pr = await session.api.read({ number: member.link.number, owner: session.args.owner, repo: session.args.repo });
  if (pr.isErr()) {
    return `${label} could not be read before its merge: ${pr.error.message}`;
  }
  if (pr.value.state !== "open") {
    return `${label} is ${pr.value.state} now, not the open pull request the lap tested`;
  }
  if (pr.value.baseRef !== batch.baseRef) {
    return `${label} now targets ${pr.value.baseRef}, not ${batch.baseRef}, the base the lap tested it over`;
  }
  if (pr.value.headSha !== member.link.headSha) {
    return `${label}'s head moved to ${pr.value.headSha.slice(0, 10)} after the lap tested ${member.link.headSha.slice(0, 10)}`;
  }
  return undefined;
}

/** Land one member onto `tip`, then read the new tip back against the member's simulated squash. */
async function landMember({
  session,
  batch,
  member,
  tip,
}: {
  session: LapSession;
  batch: LapBatch;
  member: BatchMember;
  tip: string;
}): Promise<MemberLanding> {
  const { deps } = session;
  const label = `#${String(member.link.number)}`;
  const moved = await memberMoved({ batch, label, member, session });
  if (moved !== undefined) {
    return { kind: "stopped", landed: false, why: [moved] };
  }
  const facts = deps.memberMergeFacts({ base: tip, head: member.link.headSha });
  if (facts.isErr()) {
    return { kind: "stopped", landed: false, why: [`${label}'s merge could not be measured: ${facts.error.message}`] };
  }
  const own = session.args.memberLoop?.find((one) => one.number === member.link.number);
  const loop = own === undefined ? undefined : { reason: own.reason, subject: CODEX_LOOP_SUBJECT };
  const refusals = memberAcknowledgementRefusals({
    actual: facts.value,
    freshnessSubject: BASE_MOVED_ACK,
    number: member.link.number,
    simulated: member.simulatedBaseMoved,
    ...(loop === undefined ? {} : { loopSubject: loop.subject }),
  });
  if (refusals.length > 0) {
    return { kind: "stopped", landed: false, why: refusals };
  }
  const acknowledge = memberAcknowledgement({
    facts: facts.value,
    freshnessSubject: BASE_MOVED_ACK,
    tested: batch.tested,
    ...(loop === undefined ? {} : { loop }),
  });
  const single = memberSession({ member, session, tip });
  const exit = await land({ session: { ...single, args: { ...single.args, acknowledge } } });
  return readBack({ batch, exit, label, member, session, tip });
}

/**
 * Whether GitHub itself says the member merged, for a base that moved somewhere the lap did not predict — where
 * neither the merge's exit (a lost response) nor the tip (another landing may have slipped in) settles it. GitHub's
 * merge time decides, never `closed`, which a pull request closed WITHOUT merging also reads, from the REST read
 * alone, so a failed second read cannot discard it. When that read fails nothing confirms the member, so it counts as
 * NOT landed whatever its merge exited: a failure posted on a head that did merge costs nothing, while the batch's
 * green left on one that did not is exactly what the stop exists to withdraw.
 */
async function mergedPerGithub({
  session,
  member,
  exit,
}: {
  session: LapSession;
  member: BatchMember;
  exit: number;
}): Promise<{ readonly landed: boolean; readonly why: string }> {
  const label = `#${String(member.link.number)}`;
  const pr = await session.api.mergeRecord({
    number: member.link.number,
    owner: session.args.owner,
    repo: session.args.repo,
  });
  if (pr.isErr()) {
    return {
      landed: false,
      why: `${label}'s state could not be read (${pr.error.message}), so nothing confirms its merge (exit ${String(exit)}) and it is posted failed; read it on GitHub before landing it again`,
    };
  }
  if (pr.value.mergedAtIso === undefined) {
    return {
      landed: false,
      why: `GitHub records no merge of ${label} (${pr.value.state}), so it counts as not landed`,
    };
  }
  return { landed: true, why: `GitHub records ${label} merged at ${pr.value.mergedAtIso}, so it counts as landed` };
}

/**
 * Read the base back after a member's merge, WHATEVER its exit said: a merge can reach GitHub and still exit
 * non-zero (a lost response), so only the base itself says whether the member landed. Unmoved, it did not; moved
 * to the predicted commit, it did, and a non-zero exit then still stops the batch; moved anywhere else, something
 * landed that the lap did not predict, and GitHub's own state of the member says whether it was this one.
 */
async function readBack({
  session,
  batch,
  member,
  tip,
  exit,
  label,
}: {
  session: LapSession;
  batch: LapBatch;
  member: BatchMember;
  tip: string;
  exit: number;
  label: string;
}): Promise<MemberLanding> {
  const { deps } = session;
  const exited = `exit ${String(exit)}`;
  const after = await deps.fetchRefs({ baseRef: batch.baseRef, number: member.link.number });
  if (after.isOk() && after.value.baseTip === tip) {
    return {
      kind: "stopped",
      landed: false,
      why: [`${label} did not land (${exited}); the base is still ${tip.slice(0, 10)}`],
    };
  }
  const landed = after.andThen((refs) => deps.commitFacts({ sha: refs.baseTip }));
  if (landed.isErr()) {
    const merged = await mergedPerGithub({ exit, member, session });
    return {
      kind: "stopped",
      landed: merged.landed,
      why: [
        `${label}'s merge ended (${exited}), and the base could not be read back: ${landed.error.message}`,
        merged.why,
      ],
    };
  }
  const findings = landedCommitFindings({ expectedParent: tip, landed: landed.value, link: member.link });
  if (findings.length > 0) {
    const merged = await mergedPerGithub({ exit, member, session });
    return {
      kind: "stopped",
      landed: merged.landed,
      why: [...findings, `${label}'s merge ended (${exited})`, merged.why],
    };
  }
  if (exit !== EXIT_OK) {
    const why = `${label}'s merge reported ${exited}, yet the base now carries it as predicted (${landed.value.sha.slice(0, 10)})`;
    return { kind: "stopped", landed: true, why: [why] };
  }
  return { kind: "landed", tip: landed.value.sha };
}

/** Post the stopped failure on every member that did not land, saying so for any it could not reach. */
async function invalidate({
  session,
  batch,
  members,
  why,
}: {
  session: LapSession;
  batch: LapBatch;
  members: readonly BatchMember[];
  why: string;
}): Promise<void> {
  const statuses = batchStoppedStatuses({ baseTip: batch.baseTip, why });
  for (const member of members) {
    const posted = await post({ session: memberSession({ member, session, tip: batch.baseTip }), statuses });
    if (!posted) {
      session.deps.writeDiagnostic(
        `github lap: #${String(member.link.number)} still carries the batch's green — post a failure on it before landing it alone`,
      );
    }
  }
}

/**
 * Land every member of a green batch in order, stopping at the first that does not land as predicted.
 *
 * @param batch the simulated batch the lap just proved green
 * @returns `EXIT_OK` when every member landed as the chain predicted, else `EXIT_ERROR`
 */
export async function landBatch({ session, batch }: { session: LapSession; batch: LapBatch }): Promise<number> {
  const { deps } = session;
  let tip = batch.baseTip;
  for (const [index, member] of batch.members.entries()) {
    const landing = await landMember({ batch, member, session, tip });
    if (landing.kind === "stopped") {
      const landedCount = index + (landing.landed ? 1 : 0);
      diagnose({ deps, lines: landing.why.map((why) => `github lap: batch stopped — ${why}`) });
      await invalidate({ batch, members: batch.members.slice(landedCount), session, why: landing.why[0]! });
      deps.out(`github lap: batch landed ${String(landedCount)} of ${String(batch.members.length)} on one lap`);
      return EXIT_ERROR;
    }
    deps.out(
      `github lap: landed #${String(member.link.number)} as ${landing.tip.slice(0, 10)}, the tree the batch simulated`,
    );
    tip = landing.tip;
  }
  deps.out(`github lap: batch landed ${String(batch.members.length)} of ${String(batch.members.length)} on one lap`);
  return EXIT_OK;
}
