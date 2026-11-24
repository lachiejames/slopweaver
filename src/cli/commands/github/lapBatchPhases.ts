/**
 * A batch lap's preflight and its one lap: read every member, fetch every head over ONE base tip, simulate the
 * squash chain (`./lapBatchCore.ts` says why that stands for the batch), refuse on anything that would stop the
 * landing anyway, then run the lanes once over the chain's last commit and post the verdict on every member's head.
 * Landing is `./lapBatchLand.ts`'s.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubLapApi } from "../../../outbound/github/lapApi.js";
import {
  batchMemberRefusals,
  batchNote,
  batchPreflightOverrun,
  type LapBatchMember,
  memberRevertRefusal,
  type SquashLink,
} from "./lapBatchCore.js";
import type { GithubLapArgs } from "./lapCore.js";
import type { GithubLapDeps, LapSession } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import type { LapTarget } from "./lapLanes.js";
import { protectionFacts } from "./lapPhases.js";
import { post } from "./lapStatusPost.js";
import { lapPreflightVerdict } from "./lapVerdict.js";

/** One member as the batch will land it: its simulated squash, and what its merge will report over that link. */
export interface BatchMember {
  readonly link: SquashLink;
  /** The commit the member is squashed onto: the base tip for the first member, the previous link after. */
  readonly onto: string;
  /** The `base-moved` paths its merge reports over `onto`, held against the real tip before it lands. */
  readonly simulatedBaseMoved: readonly string[];
}

/** What a passed batch preflight hands on. */
export interface LapBatch {
  readonly baseRef: string;
  readonly baseTip: string;
  readonly members: readonly BatchMember[];
  /** The chain's last commit, the one the lanes run over. */
  readonly tested: string;
  readonly notes: readonly string[];
}

/** Read every member, in order, or every member that could not be read. */
async function readMembers({
  api,
  args,
  numbers,
}: {
  api: GithubLapApi;
  args: GithubLapArgs;
  numbers: readonly number[];
}): Promise<Result<readonly LapBatchMember[], readonly LapError[]>> {
  const members: LapBatchMember[] = [];
  const failed: LapError[] = [];
  for (const number of numbers) {
    const pr = await api.read({ number, owner: args.owner, repo: args.repo });
    if (pr.isErr()) {
      failed.push(LapErrors.refused({ reason: `could not read #${String(number)}: ${pr.error.message}` }));
      continue;
    }
    members.push({ baseRef: pr.value.baseRef, headSha: pr.value.headSha, number, state: pr.value.state });
  }
  return failed.length > 0 ? err(failed) : ok(members);
}

/** The refusal for a preflight past its deadline once the named stage passed its own checks, or `undefined` while time remains. */
type PreflightOverrun = (args: { stage: string }) => LapError | undefined;

/** Fetch every member's head into its private ref, requiring one base tip throughout and every head unmoved. */
async function fetchMembers({
  deps,
  members,
  overrun,
}: {
  deps: GithubLapDeps;
  members: readonly LapBatchMember[];
  overrun: PreflightOverrun;
}): Promise<Result<string, readonly LapError[]>> {
  let baseTip: string | undefined;
  for (const member of members) {
    const refs = await deps.fetchRefs({ baseRef: member.baseRef, number: member.number });
    if (refs.isErr()) {
      return err([refs.error]);
    }
    if (refs.value.headSha !== member.headSha) {
      const reason = `#${String(member.number)}'s head moved between two reads (${member.headSha}, then ${refs.value.headSha}); run the lap again`;
      return err([LapErrors.refused({ reason })]);
    }
    if (baseTip !== undefined && refs.value.baseTip !== baseTip) {
      const reason = `${member.baseRef} moved while the batch was fetched (${baseTip}, then ${refs.value.baseTip}); run the lap again`;
      return err([LapErrors.refused({ reason })]);
    }
    const late = overrun({ stage: `fetching #${String(member.number)}` });
    if (late !== undefined) {
      return err([late]);
    }
    baseTip = refs.value.baseTip;
  }
  return ok(baseTip!);
}

/**
 * What one member's merge will report over its link, refusing a member that would restore older content and a
 * measurement that finished past the deadline, in that order.
 */
function measureOverLink({
  deps,
  member,
  onto,
  overrun,
}: {
  deps: GithubLapDeps;
  member: LapBatchMember;
  onto: string;
  overrun: PreflightOverrun;
}): Result<readonly string[], readonly LapError[]> {
  const label = `#${String(member.number)}`;
  const facts = deps.memberMergeFacts({ base: onto, head: member.headSha });
  if (facts.isErr()) {
    return err([facts.error]);
  }
  const reverts = memberRevertRefusal({ number: member.number, reverted: facts.value.reverted });
  if (reverts !== undefined) {
    return err([LapErrors.refused({ reason: reverts })]);
  }
  const late = overrun({ stage: `measuring ${label}'s merge over its link` });
  return late === undefined ? ok(facts.value.baseMoved) : err([late]);
}

/** Simulate the squash chain over the base tip, measuring each member's `base-moved` paths over its own link. */
function simulateChain({
  deps,
  baseTip,
  members,
  overrun,
}: {
  deps: GithubLapDeps;
  baseTip: string;
  members: readonly LapBatchMember[];
  overrun: PreflightOverrun;
}): Result<readonly BatchMember[], readonly LapError[]> {
  const chain: BatchMember[] = [];
  let onto = baseTip;
  for (const member of members) {
    const label = `#${String(member.number)}`;
    const squash = deps.simulateSquash({ head: member.headSha, message: `simulated squash of ${label}`, onto });
    if (squash.isErr()) {
      return err([squash.error]);
    }
    if (squash.value.kind === "conflict") {
      const reason = `${label} conflicts with the members before it over the base, in ${squash.value.paths.join(", ")}; land it in a later batch or rebase it`;
      return err([LapErrors.refused({ reason })]);
    }
    const squashLate = overrun({ stage: `simulating ${label}'s squash` });
    if (squashLate !== undefined) {
      return err([squashLate]);
    }
    const measured = measureOverLink({ deps, member, onto, overrun });
    if (measured.isErr()) {
      return err(measured.error);
    }
    const link = {
      commit: squash.value.commit,
      headSha: member.headSha,
      number: member.number,
      tree: squash.value.tree,
    };
    chain.push({ link, onto, simulatedBaseMoved: measured.value });
    onto = squash.value.commit;
  }
  return ok(chain);
}

/**
 * Everything a batch's preflight reads and judges, before any lock, post or lane: every member open and on one
 * base, fetched over one base tip, squashed into a chain without a conflict, and the chain's plan sources the ones
 * the running CLI would run — then the same standing refusals a single lap has. No stage STARTS past
 * `LAP_BATCH_PREFLIGHT_DEADLINE_MS`: it is checked once a stage has passed its own checks and before the next
 * starts, so a stage's own refusal always outranks it, and a refusal past it names the stage just finished. The
 * last stage has no check after it, because a preflight that finished has nothing left for a deadline to bound.
 *
 * @param numbers the members, in landing order
 * @returns the simulated batch and the notes to print, or every reason it will not run
 */
export async function preflightBatch({
  api,
  args,
  deps,
  numbers,
}: {
  api: GithubLapApi;
  args: GithubLapArgs;
  deps: GithubLapDeps;
  numbers: readonly number[];
}): Promise<Result<LapBatch, readonly LapError[]>> {
  const startedMs = deps.now().getTime();
  const overrun: PreflightOverrun = ({ stage }) => {
    const reason = batchPreflightOverrun({ nowMs: deps.now().getTime(), stage, startedMs });
    return reason === undefined ? undefined : LapErrors.refused({ reason });
  };
  const read = await readMembers({ api, args, numbers });
  if (read.isErr()) {
    return err(read.error);
  }
  const memberRefusals = batchMemberRefusals({ members: read.value });
  if (memberRefusals.length > 0) {
    return err(memberRefusals.map((reason) => LapErrors.refused({ reason })));
  }
  const readLate = overrun({ stage: "reading the members" });
  if (readLate !== undefined) {
    return err([readLate]);
  }
  const baseRef = read.value[0]!.baseRef;
  const baseTip = await fetchMembers({ deps, members: read.value, overrun });
  if (baseTip.isErr()) {
    return err(baseTip.error);
  }
  const chain = simulateChain({ baseTip: baseTip.value, deps, members: read.value, overrun });
  if (chain.isErr()) {
    return err(chain.error);
  }
  const tested = chain.value.at(-1)!.link.commit;
  const differing = deps.planSourcesDiffering({ headSha: tested });
  const facts = await protectionFacts({ api, args, baseRef });
  if (differing.isErr() || facts.isErr()) {
    return err([differing, facts].flatMap((one) => (one.isErr() ? [one.error].flat() : [])));
  }
  const verdict = lapPreflightVerdict({
    facts: {
      ...facts.value,
      baseRef,
      baseTip: baseTip.value,
      headContainsBase: true,
      headSha: tested,
      planSourcesDiffering: differing.value,
      prState: "open",
    },
  });
  if (verdict.refusals.length > 0) {
    return err(verdict.refusals.map((reason) => LapErrors.refused({ reason })));
  }
  return ok({ baseRef, baseTip: baseTip.value, members: chain.value, notes: verdict.notes, tested });
}

/**
 * The session one member's posts, hold, merge and release run under: the member's own number and head, over the
 * tip it is landed onto. It is never a batch, so nothing it reaches files a receipt as one.
 *
 * @param session the batch's own session
 * @param member whose number, head and simulated squash the session carries
 * @param tip the base tip the member is posted over or landed onto
 * @returns the member's session
 */
export function memberSession({
  session,
  member,
  tip,
}: {
  session: LapSession;
  member: BatchMember;
  tip: string;
}): LapSession {
  const { batch: _batch, memberLoop: _memberLoop, ...single } = session.args;
  return {
    ...session,
    args: { ...single, number: member.link.number },
    refs: { baseTip: tip, headSha: member.link.headSha },
  };
}

/**
 * The target a batch's one lap runs over: the chain's last commit, posted on every member's head with the batch
 * note, and receipted with every link.
 *
 * @param session the batch's own session
 * @param batch the simulated batch
 * @returns the target `lapLanes` runs over
 */
export function batchTarget({ session, batch }: { session: LapSession; batch: LapBatch }): LapTarget {
  return {
    baseTip: batch.baseTip,
    batch: batch.members.map((member) => member.link),
    note: batchNote({ size: batch.members.length }),
    post: async ({ statuses }) => {
      for (const member of batch.members) {
        const posted = await post({ session: memberSession({ member, session, tip: batch.baseTip }), statuses });
        if (!posted) {
          return false;
        }
      }
      return true;
    },
    tested: batch.tested,
  };
}
