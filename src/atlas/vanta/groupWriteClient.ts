/**
 * The Vanta write that decides what a person is OBLIGED to do: which groups they are in.
 *
 * ## Why this is the group write and not a policy write
 *
 * Vanta hangs a person's policy-acceptance obligations off group membership. Being in
 * `Default - Vanta entry group` assigns the ISMS governance pack plus Cryptography and Secure Development,
 * and the last two carry PER-PERSON acceptance tests that a wrongly-assigned person turns red — measured.
 * The reviewed Manage API contract has no operation that
 * changes which documents a group assigns (`groupApiSchemas.ts` carries that absence and how to re-check
 * it), so membership is the lever this door has, and it is the one the owner delegates: the owner never makes
 * these changes by hand in Vanta, this door does.
 *
 * ## Both calls are BATCH endpoints, and that is not an implementation detail
 *
 * `POST /v1/groups/{groupId}/add-people` and `.../remove-people` each take 1–100 `{id}` updates and answer
 * 200 for the batch with a per-person `SUCCESS`/`ERROR` in `results`. A caller reading only the HTTP status
 * reports a move green while half of it was refused, so every consumer here works from
 * {@link reconcileVantaGroupLeg}.
 *
 * ## Reconciliation is by ID, never by count
 *
 * An answer with the right NUMBER of results and the wrong ids in them is the failure a count cannot see,
 * and it is the one that would let a run report three named people moved when three other people were. So the
 * reconciler requires exactly one result for every id that was sent, and nothing else, and refuses the
 * response otherwise rather than summarising it.
 *
 * ## Neither call may be retried
 *
 * `transport.ts` retries a retryable fault regardless of method. For these two endpoints that is not safe
 * in the way it sounds: a first call that LANDS and then times out is followed by a retry whose per-person
 * results report "already in that group" for people the first call actually moved, so the run reports a
 * failure that did not happen. Both legs therefore pass `retryPolicy: "never"` and an ambiguous fault is
 * reported as unknown, which is what it is.
 *
 * ## The single-person routes are deliberately not built
 *
 * `POST /groups/{groupId}/people` and `DELETE /groups/{groupId}/people/{personId}` exist and are not
 * reached from here. One of anything is a batch of one, and a second pair of paths would be a second
 * preview shape, a second response schema and a second arm of the digest for no behaviour the batch does
 * not already have.
 *
 * Each leg reads its answer through its own strict boundary in {@link VANTA_GROUP_WRITE_BOUNDARIES}: the two
 * share a schema, but the endpoint leads every refusal, so each names its own.
 */
import { defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  VANTA_GROUP_MEMBERSHIP_BATCH_MAX,
  type VantaGroupMembershipResponse,
  type VantaGroupMembershipResult,
  type VantaGroupMembershipUpdate,
  vantaGroupMembershipBody,
  vantaGroupMembershipResponseSchema,
} from "./groupApiSchemas.js";
import { type VantaGroupWriteError, VantaGroupWriteErrors } from "./groupWriteErrors.js";
import { vantaTransportFailureLines } from "./httpErrors.js";
import type { VantaTokenProvider } from "./oauth.js";
import type { VantaTransport } from "./transport.js";
import { parseVantaWriteBody, performVantaWrite } from "./writeTransport.js";

/** Which way one leg moves people. Both legs are the same request shape at different paths. */
export type VantaGroupDirection = "add" | "remove";

/**
 * One strict boundary per leg, keyed by direction and named by its method and path template.
 *
 * @internal — exported so a test can lock the endpoint each direction names.
 */
export const VANTA_GROUP_WRITE_BOUNDARIES = {
  add: defineBoundary({
    endpoint: "POST /v1/groups/{groupId}/add-people",
    schema: vantaGroupMembershipResponseSchema,
  }),
  remove: defineBoundary({
    endpoint: "POST /v1/groups/{groupId}/remove-people",
    schema: vantaGroupMembershipResponseSchema,
  }),
} as const satisfies Record<VantaGroupDirection, unknown>;

/**
 * The bulk add endpoint. Exported so `writePreview.ts` resolves the same path rather than re-deriving it.
 *
 * @param groupId the group's provider id
 * @returns the endpoint path
 */
export function groupAddPeoplePath({ groupId }: { groupId: string }): string {
  return `/v1/groups/${encodeURIComponent(groupId)}/add-people`;
}

/**
 * The bulk remove endpoint. Exported so `writePreview.ts` resolves the same path rather than re-deriving it.
 *
 * @param groupId the group's provider id
 * @returns the endpoint path
 */
export function groupRemovePeoplePath({ groupId }: { groupId: string }): string {
  return `/v1/groups/${encodeURIComponent(groupId)}/remove-people`;
}

/**
 * The endpoint one direction addresses. The one place the two paths are chosen between, so the preview, the
 * client and the digest cannot disagree about which leg is which.
 *
 * @param direction which way this leg moves people
 * @param groupId the group's provider id
 * @returns the endpoint path
 */
export function groupLegPath({ direction, groupId }: { direction: VantaGroupDirection; groupId: string }): string {
  return direction === "add" ? groupAddPeoplePath({ groupId }) : groupRemovePeoplePath({ groupId });
}

/** One group's membership change in ONE direction, as both the preview and the client take it. */
export interface VantaGroupBatch {
  readonly groupId: string;
  readonly updates: readonly VantaGroupMembershipUpdate[];
}

/**
 * The two writes this module makes. Each takes one group and one non-empty batch.
 *
 * @internal
 */
export interface VantaGroupWriteClient {
  addPeopleToGroup: (input: VantaGroupBatch) => Promise<Result<VantaGroupMembershipResponse, VantaGroupWriteError>>;
  removePeopleFromGroup: (
    input: VantaGroupBatch,
  ) => Promise<Result<VantaGroupMembershipResponse, VantaGroupWriteError>>;
}

/**
 * One group's membership change, both directions, as the verb assembles it. Either list may be empty — an
 * empty one is a leg that is not sent at all — but not both, which
 * {@link checkVantaGroupMembershipPlan} refuses.
 */
export interface VantaGroupMembershipPlan {
  readonly groupId: string;
  readonly add: readonly VantaGroupMembershipUpdate[];
  readonly remove: readonly VantaGroupMembershipUpdate[];
}

/** Every way one leg of a plan is malformed, reported against the direction it was written in. */
function legProblems({
  direction,
  updates,
}: {
  direction: VantaGroupDirection;
  updates: readonly VantaGroupMembershipUpdate[];
}): readonly string[] {
  const problems: string[] = [];
  if (updates.length > VANTA_GROUP_MEMBERSHIP_BATCH_MAX) {
    problems.push(
      `--${direction} names ${String(updates.length)} people, more than Vanta's own batch maximum of ` +
        `${String(VANTA_GROUP_MEMBERSHIP_BATCH_MAX)} — split it rather than letting the endpoint truncate it`,
    );
  }
  const seen = new Set<string>();
  for (const update of updates) {
    if (seen.has(update.id)) {
      problems.push(
        `${update.id} appears twice in --${direction} — Vanta answers per person, so a duplicate is ambiguous`,
      );
    }
    seen.add(update.id);
  }
  return problems;
}

/**
 * Refuse a plan Vanta's own endpoints would refuse, or that no reader could check, before spending a
 * request on it.
 *
 * The same id on both sides is refused rather than ordered: the two legs are separate HTTP calls, so
 * "added then removed" and "removed then added" are different outcomes and neither is what anybody meant.
 *
 * @param plan the group and both directions as the caller assembled them
 * @returns the plan unchanged when it is worth sending, or every reason it is not
 */
export function checkVantaGroupMembershipPlan({
  plan,
}: {
  plan: VantaGroupMembershipPlan;
}): Result<VantaGroupMembershipPlan> {
  const problems: string[] = [];
  if (plan.groupId.trim() === "") {
    problems.push("--group named no group — pass the group's Vanta id");
  }
  if (plan.add.length === 0 && plan.remove.length === 0) {
    problems.push("this plan moves nobody — pass at least one --add or one --remove");
  }
  problems.push(...legProblems({ direction: "add", updates: plan.add }));
  problems.push(...legProblems({ direction: "remove", updates: plan.remove }));
  const adding = new Set(plan.add.map((update) => update.id));
  for (const update of plan.remove) {
    if (adding.has(update.id)) {
      problems.push(
        `${update.id} is in both --add and --remove — these are two separate calls, so the result would ` +
          "depend on which ran last",
      );
    }
  }
  return problems.length > 0 ? err(problems) : ok(plan);
}

/** What one leg did, per person, in the order the people were SENT rather than the order Vanta answered. */
export interface VantaGroupLegSummary {
  readonly direction: VantaGroupDirection;
  readonly attempted: number;
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly message: string }[];
}

/** Every way a response fails to answer exactly the question that was asked. */
function reconciliationProblems({
  requestedIds,
  results,
}: {
  requestedIds: readonly string[];
  results: readonly VantaGroupMembershipResult[];
}): readonly string[] {
  const problems: string[] = [];
  const counts = new Map<string, number>();
  for (const entry of results) {
    const already = counts.get(entry.id);
    counts.set(entry.id, already === undefined ? 1 : already + 1);
  }
  const requested = new Set(requestedIds);
  for (const id of requestedIds) {
    const answered = counts.get(id);
    if (answered === undefined) {
      problems.push(`Vanta reported nothing about ${id}, which this call sent — its outcome is UNKNOWN`);
      continue;
    }
    if (answered > 1) {
      problems.push(`Vanta reported ${String(answered)} outcomes for ${id}, which this call sent once`);
    }
  }
  for (const id of counts.keys()) {
    if (!requested.has(id)) {
      problems.push(`Vanta reported an outcome for ${id}, which this call never sent`);
    }
  }
  return problems;
}

/**
 * Turn one leg's response into a summary, refusing any response that does not answer for exactly the people
 * that were sent.
 *
 * A count check would pass a response carrying the right NUMBER of the wrong ids, which is the failure that
 * would let a run report the wrong people moved. So the ids are compared, both ways.
 *
 * @param direction which way this leg moved people
 * @param requestedIds every person id this leg sent, in send order
 * @param results the per-person outcomes Vanta returned, in whatever order it returned them
 * @returns the leg summary, or every way the response failed to answer the question asked
 */
export function reconcileVantaGroupLeg({
  direction,
  requestedIds,
  results,
}: {
  direction: VantaGroupDirection;
  requestedIds: readonly string[];
  results: readonly VantaGroupMembershipResult[];
}): Result<VantaGroupLegSummary> {
  const problems = reconciliationProblems({ requestedIds, results });
  if (problems.length > 0) {
    return err(problems);
  }
  const byId = new Map(results.map((entry) => [entry.id, entry]));
  const succeeded: string[] = [];
  const failed: { id: string; message: string }[] = [];
  for (const id of requestedIds) {
    const entry = byId.get(id)!;
    if (entry.status === "SUCCESS") {
      succeeded.push(entry.id);
      continue;
    }
    failed.push({ id: entry.id, message: entry.message });
  }
  return ok({ attempted: requestedIds.length, direction, failed, succeeded });
}

/** What a whole plan did, one summary per direction. A leg that was never sent is absent. */
export interface VantaGroupMembershipSummary {
  readonly groupId: string;
  readonly legs: readonly VantaGroupLegSummary[];
}

/**
 * Whether every person in every leg that ran landed. A plan with a leg that never ran is not fully
 * successful either — the caller reports that separately, and this answers only about what came back.
 *
 * @param summary what the per-person results said
 * @returns true when every attempted move succeeded
 */
export function vantaGroupMembershipFullySucceeded({ summary }: { summary: VantaGroupMembershipSummary }): boolean {
  return summary.legs.every((leg) => leg.succeeded.length === leg.attempted);
}

async function postLeg({
  batch,
  direction,
  tokenProvider,
  transport,
}: {
  batch: VantaGroupBatch;
  direction: VantaGroupDirection;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): Promise<Result<VantaGroupMembershipResponse, VantaGroupWriteError>> {
  // The token is resolved HERE, before `performVantaWrite`, so that a failure to get one is reportable as
  // NOT_DISPATCHED. `writeTransport.ts` returns on a bad `getToken()` before it ever calls
  // `transport.request()`, so a token failure folded into that call's error is indistinguishable from a
  // request that went out and came back unreadable — and the two oblige an auditor to do opposite things.
  const token = await tokenProvider.getToken();
  if (token.isErr()) {
    return err(VantaGroupWriteErrors.notDispatched({ problems: vantaTransportFailureLines({ error: token.error }) }));
  }
  // A provider over the token already in hand: `performVantaWrite` takes a provider, and re-asking the real
  // one here could fail a second time INSIDE the call, which is the ambiguity this whole function removes.
  const held: VantaTokenProvider = { getToken: async () => ok(token.value) };
  const raw = await performVantaWrite({
    body: vantaGroupMembershipBody({ updates: batch.updates }),
    headers: { "content-type": "application/json" },
    method: "POST",
    path: groupLegPath({ direction, groupId: batch.groupId }),
    retryPolicy: "never",
    tokenProvider: held,
    transport,
  });
  if (raw.isErr()) {
    return err(VantaGroupWriteErrors.unreadable({ problems: raw.error }));
  }
  const parsed = parseVantaWriteBody({
    body: raw.value.body,
    boundary: VANTA_GROUP_WRITE_BOUNDARIES[direction],
    surface: `group ${direction}-people`,
  });
  if (parsed.isErr()) {
    return err(VantaGroupWriteErrors.unreadable({ problems: parsed.error }));
  }
  return ok(parsed.value);
}

/**
 * Build the group membership write client.
 *
 * @param tokenProvider mints/reuses the bearer token for each request
 * @param transport the bound Vanta transport
 * @returns the client
 */
export function createVantaGroupWriteClient({
  tokenProvider,
  transport,
}: {
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): VantaGroupWriteClient {
  return {
    addPeopleToGroup: (batch) => postLeg({ batch, direction: "add", tokenProvider, transport }),
    removePeopleFromGroup: (batch) => postLeg({ batch, direction: "remove", tokenProvider, transport }),
  };
}
