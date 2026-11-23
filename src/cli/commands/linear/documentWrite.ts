/**
 * The irreversible half of `slopweaver linear document`: the update's pre-write check, then reserve, mutate,
 * read back and confirm. `./documentRun.ts` is the sequence around it; this is what runs once the door passed.
 *
 * The same contract `./issueWrite.ts` proves for an issue, and for the same reasons: the id is caller-chosen
 * so a lost response is settled by a read rather than a guess, and an update is REPLACE-shaped so it refuses
 * over a page somebody edited since slopweaver last wrote it.
 */
import type { LinearDocumentWriteApi, ReadLinearDocument } from "../../../corpus/linear/writeDocument.js";
import {
  confirmDocument,
  ownershipOfDocument,
  releaseDocumentReservation,
  reserveDocument,
} from "../../../outbound/linear/documentLedger.js";
import { renderDocumentContent } from "../../../outbound/linear/documentRender.js";
import type { LinearDocumentDestination, LinearDocumentForm } from "../../../outbound/linear/documentTypes.js";
import { compareStoredBody } from "../../../outbound/linear/fidelity.js";
import { descriptionHash } from "../../../outbound/linear/issueLedger.js";
import { settledBeforeWire } from "../../../outbound/linear/sendFailure.js";
import {
  documentCreateInputFor,
  documentUpdateInputFor,
  type LinearDocumentOutcome,
  sameDestination,
} from "./documentCore.js";
import type { LinearDocumentWriteDeps } from "./documentDeps.js";

/** Everything the effect phase needs, once the cheap checks have passed. */
export interface DocumentWriteContext {
  readonly api: LinearDocumentWriteApi;
  readonly deps: LinearDocumentWriteDeps;
  readonly home: string;
  readonly id: string;
  readonly verb: "create" | "update";
  /** The form as it will be SENT — references linked, mentions resolved. */
  readonly form: LinearDocumentForm;
}

/**
 * What the update's pre-write check found: a refusal, or clearance carrying the instant the ledger first
 * reserved the page and the page's `updatedAt` as the check read it. A create carries neither.
 */
export type DocumentPrecheck =
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "clear"; readonly reservedIso: string | undefined; readonly priorUpdatedAt: string | undefined };

/**
 * Ownership, destination and overwrite safety for an update, against a LIVE read-back. A create is clear.
 *
 * Still a check and not a lock: `DocumentUpdateInput` carries no compare-and-swap, so a person can edit
 * between this read and the mutation. That residual race is stated rather than papered over, exactly as
 * `./issueWrite.ts`'s `updatePrecheck` states it. Its mirror sits after the mutation: the digest `confirm`
 * records comes from a SEPARATE read-back, so an edit landing between our write and that read is recorded as
 * ours and a later update would replace it. Both windows are the same missing primitive.
 *
 * @param ctx the write context
 * @returns the refusal, or clearance carrying the record's reservation instant for the confirm
 */
export async function documentUpdatePrecheck({ ctx }: { ctx: DocumentWriteContext }): Promise<DocumentPrecheck> {
  if (ctx.verb === "create") {
    return { kind: "clear", priorUpdatedAt: undefined, reservedIso: undefined };
  }
  const ownership = ownershipOfDocument({ home: ctx.home, id: ctx.id });
  if (!ownership.owned) {
    return { kind: "refused", reason: ownership.reason };
  }
  const { record } = ownership;
  if (!sameDestination({ a: record.destination, b: ctx.form.fields.destination })) {
    return {
      kind: "refused",
      reason:
        `document ${ctx.id} was created on ${record.destination.kind} ${record.destination.id}, and this form ` +
        `names ${ctx.form.fields.destination.kind} ${ctx.form.fields.destination.id}. An update never moves a ` +
        "page; put the original destination back in the form.",
    };
  }
  const readBack = await ctx.api.readDocument({ id: ctx.id });
  if (readBack.isErr()) {
    return {
      kind: "refused",
      reason: `could not read the document back before updating it: ${readBack._unsafeUnwrapErr().message}`,
    };
  }
  const found = readBack._unsafeUnwrap();
  if (found === undefined) {
    return { kind: "refused", reason: `document ${ctx.id} does not exist, so there is nothing to update` };
  }
  if (record.lastSeenContentHash !== descriptionHash({ description: found.content })) {
    return {
      kind: "refused",
      reason:
        `document "${found.title}" was edited since slopweaver last wrote it (updatedAt ${found.updatedAt}), ` +
        "and an update replaces the whole page. Fold the edit into the form, or leave the page to its editor.",
    };
  }
  return { kind: "clear", priorUpdatedAt: found.updatedAt, reservedIso: record.reservedIso };
}

/** Record what Linear stored, carrying the reservation instant and destination forward. */
function confirm({
  ctx,
  found,
  reservedIso,
}: {
  ctx: DocumentWriteContext;
  found: ReadLinearDocument;
  reservedIso: string;
}): void {
  confirmDocument({
    // The content as Linear STORES it, not what we sent: Linear normalises markdown on ingest, so the digest
    // has to be taken over the stored form or every later update reports a phantom conflict.
    content: found.content,
    destination: ctx.form.fields.destination,
    home: ctx.home,
    id: ctx.id,
    nowIso: ctx.deps.nowIso(),
    reservedIso,
    title: found.title,
    updatedAt: found.updatedAt,
    url: found.url,
  });
}

/**
 * Whether a read-back PROVES an update applied: the stored title and content are exactly what was sent.
 * Deliberately strict — the page existed before the attempt, so finding it proves nothing, and Linear's
 * markdown normalisation means a landed update can still read as unproven. Unknown is the honest answer then.
 *
 * @param ctx the write context
 * @param found the document as read back
 * @returns true only when everything the update sent is visibly stored
 */
function updateProvenBy({ ctx, found }: { ctx: DocumentWriteContext; found: ReadLinearDocument }): boolean {
  return (
    found.content === renderDocumentContent({ content: ctx.form.content }) && found.title === ctx.form.fields.title
  );
}

/**
 * Whether a read-back after a lost response proves THIS write landed. Always the page at our id (a
 * read answering with another page proves nothing about ours). A create's id was freshly reserved, so the page
 * there carrying the title we sent is ours (a foreign page at that id would otherwise be confirmed into
 * the ledger, and a later update would own it); an update's page existed before, so see `updateProvenBy`.
 *
 * @param ctx the write context
 * @param found the document as read back
 * @returns true only when the read-back shows this write
 */
function landingProvenBy({ ctx, found }: { ctx: DocumentWriteContext; found: ReadLinearDocument }): boolean {
  if (found.id !== ctx.id) {
    return false;
  }
  if (ctx.verb === "create") {
    return found.title === ctx.form.fields.title;
  }
  return updateProvenBy({ ctx, found });
}

/**
 * A mutation that returned an error. What settles it differs by verb, for the reason `./issueWrite.ts`'s
 * `afterLostResponse` records: a create's id was freshly reserved, so a page found there proves it landed; an
 * update's page existed before, so only its stored content being what we sent proves anything.
 *
 * @param ctx the write context
 * @param reason the transport error the mutation returned
 * @param reservedIso the reservation instant to carry into the confirm
 * @returns what is actually known about the write
 */
async function afterLostResponse({
  ctx,
  reason,
  reservedIso,
}: {
  ctx: DocumentWriteContext;
  reason: string;
  reservedIso: string;
}): Promise<LinearDocumentOutcome> {
  const readBack = await ctx.api.readDocument({ id: ctx.id });
  if (readBack.isErr()) {
    return { kind: "indeterminate", reason };
  }
  const found = readBack._unsafeUnwrap();
  if (found === undefined) {
    return ctx.verb === "create" ? { kind: "failed", reason } : { kind: "indeterminate", reason };
  }
  if (!landingProvenBy({ ctx, found })) {
    return { kind: "indeterminate", reason };
  }
  confirm({ ctx, found, reservedIso });
  return {
    document: found,
    fidelity: compareStoredBody({ sent: renderDocumentContent({ content: ctx.form.content }), stored: found.content }),
    kind: "landedAfterError",
    reason,
  };
}

/**
 * Reserve, mutate, read back, confirm. Runs ONLY when the door passed, so a refused door leaves no claimed id.
 *
 * @param ctx the write context
 * @param reservedIso for an update, the instant the ledger first reserved the page; undefined for a create,
 *   which reserves now
 * @param priorUpdatedAt for an update, the page's `updatedAt` as the precheck read it; undefined for a create
 * @returns what became of the write
 */
export async function performDocumentWrite({
  ctx,
  reservedIso,
  priorUpdatedAt,
}: {
  ctx: DocumentWriteContext;
  reservedIso: string | undefined;
  priorUpdatedAt: string | undefined;
}): Promise<LinearDocumentOutcome> {
  const reservation = reserveIfCreate({ ctx, reservedIso });
  if (reservation.kind === "duplicate") {
    return reservation;
  }
  const mutation =
    ctx.verb === "create"
      ? await ctx.api.createDocument({ id: ctx.id, input: documentCreateInputFor({ form: ctx.form }) })
      : await ctx.api.updateDocument({ id: ctx.id, input: documentUpdateInputFor({ form: ctx.form }) });
  // Refused before the wire: nothing was sent, so a create's own reservation is released for the retry; an
  // update carried a reservation forward and took none, so it releases nothing.
  const release =
    ctx.verb === "create"
      ? () => releaseDocumentReservation({ home: ctx.home, id: ctx.id, reservedIso: reservation.reservedIso })
      : undefined;
  if (mutation.isErr() && settledBeforeWire({ error: mutation.error, release })) {
    return { kind: "failed", reason: mutation.error.message };
  }
  if (mutation.isErr()) {
    return afterLostResponse({
      ctx,
      reason: mutation._unsafeUnwrapErr().message,
      reservedIso: reservation.reservedIso,
    });
  }
  // The mutation's own response is not proof — `DocumentPayload` echoes `document { id }` alone — so the page is
  // established by reading it back at the id we chose, which is also the only source of its title and URL.
  const readBack = await ctx.api.readDocument({ id: ctx.id });
  // A read answering with another page's id has not shown ours, so it confirms nothing.
  if (readBack.isErr() || readBack._unsafeUnwrap()?.id !== ctx.id) {
    return { id: ctx.id, kind: "unconfirmed" };
  }
  const found = readBack._unsafeUnwrap()!;
  // An update's page existed before, so finding it proves nothing. Exact bytes cannot prove it either, since
  // Linear normalises markdown on ingest (`fidelity.ts`). What CAN be seen is whether the page moved at all: an
  // ignored update, or a read served before the write, still shows the `updatedAt` the precheck read.
  if (priorUpdatedAt !== undefined && found.updatedAt === priorUpdatedAt) {
    return { document: found, kind: "unapplied" };
  }
  confirm({ ctx, found, reservedIso: reservation.reservedIso });
  return {
    document: found,
    fidelity: compareStoredBody({ sent: renderDocumentContent({ content: ctx.form.content }), stored: found.content }),
    kind: "written",
  };
}

/**
 * Take the create's reservation, or carry the update's forward.
 *
 * @returns the duplicate outcome when the create's slot is taken, else the reservation instant to confirm with
 */
function reserveIfCreate({
  ctx,
  reservedIso,
}: {
  ctx: DocumentWriteContext;
  reservedIso: string | undefined;
}):
  { readonly kind: "reserved"; readonly reservedIso: string } | Extract<LinearDocumentOutcome, { kind: "duplicate" }> {
  // Only an update's precheck carries an instant, so its presence IS the update; a create reserves now.
  if (reservedIso !== undefined) {
    return { kind: "reserved", reservedIso };
  }
  const nowIso = ctx.deps.nowIso();
  const destination: LinearDocumentDestination = ctx.form.fields.destination;
  const claim = reserveDocument({ destination, home: ctx.home, id: ctx.id, nowIso });
  if (claim.kind === "taken") {
    return { kind: "duplicate", reservedIso: claim.record === undefined ? undefined : claim.record.reservedIso };
  }
  return { kind: "reserved", reservedIso: nowIso };
}
