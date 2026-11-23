/**
 * The irreversible half of `slopweaver linear initiative`: reserve, mutate, read back and confirm, for both the
 * `create`/`update` write and the append-shaped `link` edge. `./initiativeRun.ts` is the sequence around it;
 * this is what runs once the door passed.
 */
import type { LinearInitiativeWriteApi } from "../../../corpus/linear/writeInitiative.js";
import { confirmAppend, releaseAppendReservation, reserveAppend } from "../../../outbound/linear/commentLedger.js";
import type { LinearInitiativeFields, LinearInitiativeLinkForm } from "../../../outbound/linear/initiativeTypes.js";
import {
  confirmInitiative,
  releaseObjectReservation,
  reserveInitiative,
} from "../../../outbound/linear/projectLedger.js";
import { settledBeforeWire } from "../../../outbound/linear/sendFailure.js";
import {
  initiativeInputFor,
  type LinearInitiativeLinkOutcome,
  type LinearInitiativeOutcome,
} from "./initiativeCore.js";
import type { LinearInitiativeWriteDeps } from "./initiativeDeps.js";

/** The ledger family the `link` sub-verb reserves in — shared machinery, its own directory. */
const LINK_LEDGER_KIND = "linear-initiative-links";

/** Everything the initiative effect phase needs, once the cheap checks have passed. */
export interface InitiativeWriteContext {
  readonly api: LinearInitiativeWriteApi;
  readonly deps: LinearInitiativeWriteDeps;
  readonly home: string;
  readonly id: string;
  readonly fields: LinearInitiativeFields;
  readonly verb: "create" | "update";
}

/**
 * A mutation that returned an error, settled the same way `./projectRun.ts` settles a project: a create's
 * freshly-reserved id proves landing on its own, while an update's pre-existing initiative proves nothing by
 * merely existing, so it must match the name that was sent.
 *
 * @param ctx the write context
 * @param reason the transport error the mutation returned
 * @returns what is actually known about the write
 */
async function afterLostResponse({
  ctx,
  reason,
}: {
  ctx: InitiativeWriteContext;
  reason: string;
}): Promise<LinearInitiativeOutcome> {
  const readBack = await ctx.api.readInitiative({ id: ctx.id });
  if (readBack.isErr()) {
    return { kind: "indeterminate", reason };
  }
  const found = readBack._unsafeUnwrap();
  if (found === undefined) {
    return ctx.verb === "create" ? { kind: "failed", reason } : { kind: "indeterminate", reason };
  }
  if (ctx.verb === "update" && found.name !== ctx.fields.name) {
    return { kind: "indeterminate", reason };
  }
  confirmInitiative({ home: ctx.home, id: ctx.id, name: found.name, nowIso: ctx.deps.nowIso(), url: found.url });
  return { initiative: found, kind: "landed", reason };
}

/**
 * Reserve, mutate, read back, confirm. Runs ONLY when the door passed.
 *
 * @returns what is actually known about the create or update once it was attempted
 */
export async function performWrite({ ctx }: { ctx: InitiativeWriteContext }): Promise<LinearInitiativeOutcome> {
  const reservedIso = ctx.verb === "create" ? ctx.deps.nowIso() : undefined;
  if (reservedIso !== undefined) {
    const claim = reserveInitiative({ home: ctx.home, id: ctx.id, nowIso: reservedIso });
    if (claim.kind === "taken") {
      return { kind: "duplicate", reservedIso: claim.record.reservedIso };
    }
  }
  const input = initiativeInputFor({ fields: ctx.fields });
  const mutation =
    ctx.verb === "create"
      ? await ctx.api.createInitiative({ id: ctx.id, input })
      : await ctx.api.updateInitiative({ id: ctx.id, input });
  const release =
    reservedIso === undefined
      ? undefined
      : () => releaseObjectReservation({ home: ctx.home, id: ctx.id, kind: "linear-initiatives", reservedIso });
  // Refused before the wire: nothing was sent, so the create's own reservation is released for the retry.
  if (mutation.isErr() && settledBeforeWire({ error: mutation.error, release })) {
    return { kind: "failed", reason: mutation.error.message };
  }
  if (mutation.isErr()) {
    return afterLostResponse({ ctx, reason: mutation._unsafeUnwrapErr().message });
  }
  const written = mutation._unsafeUnwrap();
  // The mutation's own response is not proof — `success: true` with a null initiative is a real API shape —
  // so the object is established by reading it back at the id we chose. Under the SDK's documents that read
  // is also the only place a name or URL comes from: the mutation echoes a bare id.
  const readBack = await ctx.api.readInitiative({ id: ctx.id });
  if (readBack.isErr() || readBack._unsafeUnwrap() === undefined) {
    return { initiative: written, kind: "unconfirmed" };
  }
  const found = readBack._unsafeUnwrap()!;
  confirmInitiative({ home: ctx.home, id: ctx.id, name: found.name, nowIso: ctx.deps.nowIso(), url: found.url });
  return { initiative: found, kind: "written" };
}

/**
 * Reserve, mutate, read back, confirm — the append-shaped `link` sub-verb's own sequence.
 *
 * @returns what is actually known about the project-to-initiative edge once it was attempted
 */
export async function performLink({
  api,
  deps,
  form,
  home,
  id,
}: {
  api: LinearInitiativeWriteApi;
  deps: LinearInitiativeWriteDeps;
  form: LinearInitiativeLinkForm;
  home: string;
  id: string;
}): Promise<LinearInitiativeLinkOutcome> {
  const reservedIso = deps.nowIso();
  const claim = reserveAppend({
    home,
    id,
    kind: LINK_LEDGER_KIND,
    nowIso: reservedIso,
    subject: form.fields.initiativeId,
  });
  if (claim.kind === "taken") {
    return { kind: "duplicate", reservedIso: claim.record.reservedIso };
  }
  const mutation = await api.createInitiativeLink({
    id,
    input: { initiativeId: form.fields.initiativeId, projectId: form.fields.projectId },
  });
  const confirm = (): void => {
    confirmAppend({ home, id, kind: LINK_LEDGER_KIND, nowIso: deps.nowIso(), subject: form.fields.initiativeId });
  };
  const release = () => releaseAppendReservation({ home, id, kind: LINK_LEDGER_KIND, reservedIso });
  if (mutation.isErr() && settledBeforeWire({ error: mutation.error, release })) {
    return { kind: "failed", reason: mutation.error.message };
  }
  if (mutation.isErr()) {
    const reason = mutation._unsafeUnwrapErr().message;
    const readBack = await api.readInitiativeLink({ id });
    if (readBack.isErr()) {
      return { kind: "indeterminate", reason };
    }
    const found = readBack._unsafeUnwrap();
    if (found === undefined) {
      return { kind: "failed", reason };
    }
    confirm();
    return { kind: "landed", link: found, reason };
  }
  const readBack = await api.readInitiativeLink({ id });
  if (readBack.isErr() || readBack._unsafeUnwrap() === undefined) {
    return { kind: "unconfirmed", linkId: id };
  }
  const found = readBack._unsafeUnwrap()!;
  confirm();
  return { kind: "written", link: found };
}
