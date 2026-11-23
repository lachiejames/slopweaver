/**
 * The irreversible half of `slopweaver linear issue`: the pre-write check, then reserve, mutate, read back and
 * confirm. `./run.ts` is the sequence around it; this is what runs once the door has passed.
 *
 * Its own module because `./run.ts` sits on the file-size ratchet's debt list, and the rewrite-filed check
 * had to land in exactly this code.
 */
import type { LinearWriteApi, ReadIssue } from "../../../corpus/linear/write.js";
import { compareStoredBody } from "../../../outbound/linear/fidelity.js";
import {
  confirmIssue,
  descriptionHash,
  ownershipOf,
  releaseIssueReservation,
  reserveIssue,
} from "../../../outbound/linear/issueLedger.js";
import { settledBeforeWire } from "../../../outbound/linear/sendFailure.js";
import type { LinearIssueFields } from "../../../outbound/linear/types.js";
import { type LinearIssueArgs, type LinearIssueOutcome, updateSafety } from "./core.js";
import { createInputFor, updateInputFor } from "./issueInput.js";
import type { LinearWriteDeps } from "./writeDeps.js";

/**
 * Everything the effect phase needs, once the cheap checks have passed.
 *
 * Grouped so `perform` stays one expression and the orchestration reads as the ordered contract `./run.ts`'s
 * header describes rather than as a parameter list.
 */
export interface WriteContext {
  readonly api: LinearWriteApi;
  readonly deps: LinearWriteDeps;
  readonly home: string;
  readonly id: string;
  readonly description: string;
  readonly fields: LinearIssueFields;
  readonly args: LinearIssueArgs;
  /**
   * The Linear user id the form's `assignee` key resolved to, undefined when it assigns nobody, or null
   * when the form explicitly clears the assignee.
   */
  readonly assigneeId: string | null | undefined;
}

/**
 * The exact provider input this write sends — computed in one place, because the autonomy row's id is a
 * digest of it and a second computation is a second, possibly different, input.
 *
 * @param ctx the write context
 * @returns the create or update input
 */
export function inputFor({ ctx }: { ctx: WriteContext }): Readonly<Record<string, unknown>> {
  if (ctx.args.verb === "create") {
    return createInputFor({ assigneeId: ctx.assigneeId, description: ctx.description, fields: ctx.fields });
  }
  return updateInputFor({
    assigneeId: ctx.assigneeId,
    description: ctx.description,
    fields: ctx.fields,
    fieldsOnly: ctx.args.fieldsOnly,
    moveTeam: ctx.args.moveTeam,
  });
}

/** What the pre-write check found: a refusal, or the issue as it stood (undefined for a create). */
export type Precheck =
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "clear"; readonly before: ReadIssue | undefined };

/**
 * The `--rewrite-filed` judgement: clear only at the exact `updatedAt` the session read the issue at.
 *
 * @param found the issue as the live read-back has it now
 * @param expected the `updatedAt` the session's form was built from
 * @returns the issue, or a refusal naming both instants
 */
function rewriteFiledPrecheck({ found, expected }: { found: ReadIssue; expected: string }): Precheck {
  if (found.updatedAt === expected) {
    return { before: found, kind: "clear" };
  }
  return {
    kind: "refused",
    reason:
      `${found.identifier} changed since you read it: updatedAt is ${found.updatedAt}, not ${expected}. ` +
      "Re-read it and rebuild the form from what it says now.",
  };
}

/**
 * Ownership plus overwrite safety for an update, against a LIVE read-back.
 *
 * Unlike the dry-run path this has a real remote state to compare, which is the only way the intervening-edit
 * check means anything. Still a check and not a lock: `IssueUpdateInput` carries no compare-and-swap, so a
 * human can edit between this read and the mutation. That residual race is stated rather than papered over.
 *
 * **The ownership ledger gates a body replacement, not a field change**. A
 * `--fields-only` update provably cannot reach any prose: {@link updateInputFor} omits both `description` and
 * `title` on that path, so what is left is the structured metadata every teammate already edits in Linear.
 *
 * **`--rewrite-filed` replaces the ownership ledger, never the overwrite check** (a
 * weak ticket that is on us is rewritten without asking, into something that is good by our definition). A
 * person filed it, so there is no record of what slopweaver last wrote; what stands in for that record is the
 * `updatedAt` the session read the issue at. Any edit since — to the body or anything else — moves it, and
 * the write refuses. Coarser than the description digest, deliberately: it is the conservative direction.
 *
 * @param ctx the write context
 * @returns the refusal, or the issue as read so the caller can name it in the autonomy row
 */
export async function updatePrecheck({ ctx }: { ctx: WriteContext }): Promise<Precheck> {
  if (ctx.args.verb !== "update") {
    return { before: undefined, kind: "clear" };
  }
  const guarded = !ctx.args.fieldsOnly && ctx.args.rewriteFiled === undefined;
  const ownership = guarded ? ownershipOf({ home: ctx.home, id: ctx.id }) : undefined;
  if (ownership !== undefined && !ownership.owned) {
    return { kind: "refused", reason: ownership.reason };
  }
  const readBack = await ctx.api.readIssue({ id: ctx.id });
  if (readBack.isErr()) {
    return {
      kind: "refused",
      reason: `could not read the issue back before updating it: ${readBack._unsafeUnwrapErr().message}`,
    };
  }
  const found = readBack._unsafeUnwrap();
  if (found === undefined) {
    return { kind: "refused", reason: `issue ${ctx.id} does not exist, so there is nothing to update` };
  }
  const expected = ctx.args.rewriteFiled?.expectUpdatedAt;
  if (expected !== undefined) {
    return rewriteFiledPrecheck({ expected, found });
  }
  const safety = updateSafety({
    lastSeenDescriptionHash: ownership?.owned === true ? ownership.record.lastSeenDescriptionHash : undefined,
    remoteDescriptionHash: descriptionHash({ description: found.description }),
    scope: ctx.args.fieldsOnly ? "fields-only" : "replace-body",
  });
  return safety.safe ? { before: found, kind: "clear" } : { kind: "refused", reason: safety.reason };
}

/**
 * Reserve, mutate, read back, confirm. Runs ONLY when the door passed.
 *
 * The reservation is inside this function on purpose: a refused door must not leave a claimed id, and the
 * next honest run of the same intent must find the slot free.
 *
 * @param ctx the write context
 * @returns what became of the write
 */
export async function performWrite({ ctx }: { ctx: WriteContext }): Promise<LinearIssueOutcome> {
  const reservedIso = ctx.args.verb === "create" ? ctx.deps.nowIso() : undefined;
  if (reservedIso !== undefined) {
    const claim = reserveIssue({ home: ctx.home, id: ctx.id, nowIso: reservedIso });
    if (claim.kind === "taken") {
      return { kind: "duplicate", reservedIso: claim.record.reservedIso };
    }
  }
  const input = inputFor({ ctx });
  const mutation =
    ctx.args.verb === "create"
      ? await ctx.api.createIssue({ id: ctx.id, input })
      : await ctx.api.updateIssue({ id: ctx.id, input });
  if (mutation.isErr()) {
    // Refused before the wire: nothing was sent, so the create's own reservation is released for the retry.
    const release =
      reservedIso === undefined
        ? undefined
        : () => releaseIssueReservation({ home: ctx.home, id: ctx.id, reservedIso });
    if (settledBeforeWire({ error: mutation.error, release })) {
      return { kind: "failed", reason: mutation.error.message };
    }
    return afterLostResponse({ ctx, reason: mutation._unsafeUnwrapErr().message });
  }
  // The create's own response is not proof — the payload permits `success: true` with a null issue — so the
  // issue is established by reading it back at the id we chose. It is also now the ONLY source of the
  // identifier and the URL: `@linear/sdk`'s `IssuePayload` echoes `issue { id }` and nothing more.
  const readBack = await ctx.api.readIssue({ id: ctx.id });
  if (readBack.isErr() || readBack._unsafeUnwrap() === undefined) {
    // Unconfirmed can no longer name the identifier, because the only call that knew it is the one that
    // failed. The id we chose is what is left, and it is enough to find the issue by hand.
    return { id: ctx.id, kind: "unconfirmed" };
  }
  const found = readBack._unsafeUnwrap()!;
  confirmIssue({
    // The description as Linear STORES it, not what we sent: Linear normalises markdown on ingest, so the
    // digest has to be taken over the stored form or every later comparison reports a phantom conflict.
    description: found.description,
    home: ctx.home,
    id: ctx.id,
    identifier: found.identifier,
    nowIso: ctx.deps.nowIso(),
    updatedAt: found.updatedAt,
  });
  return {
    // A fields-only update sent no body, so there is nothing to compare and nothing to claim about it.
    fidelity: ctx.args.fieldsOnly ? undefined : compareStoredBody({ sent: ctx.description, stored: found.description }),
    identifier: found.identifier,
    kind: "written",
    url: found.url,
  };
}

/**
 * A mutation that returned an error. "The write failed" is NOT what is known at this point: the transport
 * can lose a response after Linear already committed, and `node:fetch` was measured re-sending a POST on a
 * 307, so a request that errored may well have landed. Reporting a definite failure invites a retry against
 * a ticket that exists.
 *
 * What settles it differs by verb, and conflating the two is a real bug:
 *
 *  - **create** — the issue id is CALLER-chosen and was reserved moments ago, so nothing else could have put
 *    an issue there. Finding one proves the create landed.
 *  - **update** — the issue EXISTED BEFORE the attempt. Finding it proves nothing at all. The only positive
 *    evidence is the stored body already being the body we sent; anything else is unknown, and must not be
 *    reported as success. Treating existence as proof here would also feed the fidelity comparison a
 *    before-image and label "the update never applied" as "Linear normalised it" — a flat lie.
 *
 * A `--fields-only` update sends no description, so nothing can settle it and it is always unknown.
 *
 * @param ctx the write context
 * @param reason the transport error the mutation returned
 * @returns what is actually known about the write
 */
async function afterLostResponse({ ctx, reason }: { ctx: WriteContext; reason: string }): Promise<LinearIssueOutcome> {
  const readBack = await ctx.api.readIssue({ id: ctx.id });
  if (readBack.isErr()) {
    return { kind: "indeterminate", reason };
  }
  const found = readBack._unsafeUnwrap();
  if (found === undefined) {
    // Only reachable for a create: an update whose issue is gone is likewise unproven, but a missing issue
    // after a create at a freshly reserved id does mean the create did not land.
    return ctx.args.verb === "create" ? { kind: "failed", reason } : { kind: "indeterminate", reason };
  }
  const landed = ctx.args.verb === "create" || updateProvenBy({ ctx, found });
  if (!landed) {
    return { kind: "indeterminate", reason };
  }
  confirmIssue({
    description: found.description,
    home: ctx.home,
    id: ctx.id,
    identifier: found.identifier,
    nowIso: ctx.deps.nowIso(),
    updatedAt: found.updatedAt,
  });
  return {
    fidelity: compareStoredBody({ sent: ctx.description, stored: found.description }),
    identifier: found.identifier,
    kind: "landedAfterError",
    reason,
    url: found.url,
  };
}

/**
 * Whether a read-back PROVES an update applied. Deliberately strict, because every "probably" here becomes a
 * success message over a ticket that did not change.
 *
 * The body settles the body. It does not settle anything else the update sends: a body-replacing
 * `updateInputFor` carries `title`, and either scope may carry `priority`, `estimate`, `stateId`,
 * `projectId`, `labelIds`, `cycleId`, `parentId`, an assignee and — under `--move-team` — the team, while the read-back
 * returns only `title`. So an update whose body happens to be unchanged while a field DID change would
 * otherwise be declared landed on evidence that never looked at the field. A `fields-only` update sends no
 * body and no title at all, which is why it is refused proof outright below rather than compared against either.
 *
 * @param ctx the write context
 * @param found the issue as read back
 * @returns true only when everything the update sent can be seen to have taken effect
 */
function updateProvenBy({ ctx, found }: { ctx: WriteContext; found: ReadIssue }): boolean {
  const { priority, estimate, stateId, projectId, labelIds, cycleId, parentId } = ctx.fields;
  const unverifiable = [priority, estimate, stateId, projectId, labelIds, cycleId, parentId, ctx.assigneeId].some(
    (value) => value !== undefined,
  );
  if (unverifiable || ctx.args.fieldsOnly || ctx.args.moveTeam) {
    return false;
  }
  return found.description === ctx.description && found.title === ctx.fields.title;
}
