/**
 * The four addresses of a workspace — its id and ref, and its surface's — decoded from the two replies that carry
 * them: `workspace.create`'s, for a workspace this caller just made, and `pane.list`'s, for one that already exists.
 *
 * The second is what a timed-out create needs (`./workspaceCreateRecovery.ts`): the workspace it left behind is
 * visible in `workspace.list`, which reports an id and a ref but no surface. MEASURED against the live
 * socket, `pane.list {"workspace_id": <id>}` answered `{ workspace_id, workspace_ref, panes: [{
 * selected_surface_id, selected_surface_ref, surface_ids, surface_refs, focused, … }] }`.
 *
 * Both decoders are strict, because what they return is a WRITE target — a boot line gets typed into it. A blank
 * id would take `surface.send_text`'s fallback path straight into whatever surface is focused (`./client.ts`'s
 * `CmuxTarget`). So a missing field is a failure, and a `pane.list` reply naming another workspace, no pane, or
 * more than one is refused rather than resolved to a guess: a workspace cmux has only just made has one pane.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { CmuxClient, CmuxWorkspace } from "./client.js";
import { type CmuxError, CmuxErrors } from "./errors.js";
import { nonEmptyString } from "./workspaceRow.js";

/** The one call shape every typed wrapper over the socket shares. */
export type CmuxCall = (options: {
  method: string;
  params: Readonly<Record<string, unknown>>;
}) => Promise<Result<unknown, CmuxError>>;

/** The socket method that names an existing workspace's panes and surfaces. */
const PANE_LIST_METHOD = "pane.list";

/** Require a string field on a decoded reply, or fail with a typed malformed-reply error. */
function requireString({
  value,
  field,
  method,
}: {
  value: unknown;
  field: string;
  method: string;
}): Result<string, CmuxError> {
  if (!isRecord(value) || typeof value[field] !== "string") {
    return err(CmuxErrors.malformedReply({ detail: `no string field "${field}"`, method }));
  }
  return ok(value[field]);
}

/**
 * Decode a `workspace.create` reply into the created workspace's four addresses.
 *
 * All four are REQUIRED, not defaulted: the ids are how everything afterwards addresses this workspace. A reply
 * missing one is a failure worth reporting, not a spawn worth continuing.
 *
 * @param value the decoded reply
 * @returns the created workspace, or the typed failure
 */
export function parseCreatedWorkspace({ value }: { value: unknown }): Result<CmuxWorkspace, CmuxError> {
  const method = "workspace.create";
  return requireString({ field: "workspace_ref", method, value }).andThen((workspaceRef) =>
    requireString({ field: "surface_ref", method, value }).andThen((surfaceRef) =>
      requireString({ field: "workspace_id", method, value }).andThen((workspaceId) =>
        requireString({ field: "surface_id", method, value }).map((surfaceId) => ({
          surfaceId,
          surfaceRef,
          workspaceId,
          workspaceRef,
        })),
      ),
    ),
  );
}

/** The typed malformed-reply failure for `pane.list`. */
function malformedPanes({ detail }: { detail: string }): Result<CmuxWorkspace, CmuxError> {
  return err(CmuxErrors.malformedReply({ detail, method: PANE_LIST_METHOD }));
}

/**
 * Decode a `pane.list` reply into the workspace's ids and refs and its one pane's selected surface.
 *
 * @param value the decoded reply
 * @param workspaceId the workspace the call was made for — a reply naming any other is refused
 * @returns the four addresses, or the typed failure naming what was wrong with the reply
 */
export function parseWorkspaceSurface({
  value,
  workspaceId,
}: {
  value: unknown;
  workspaceId: string;
}): Result<CmuxWorkspace, CmuxError> {
  if (!isRecord(value)) {
    return malformedPanes({ detail: "the reply is not an object" });
  }
  const repliedId = nonEmptyString({ field: "workspace_id", value });
  if (repliedId !== workspaceId) {
    return malformedPanes({ detail: `asked for workspace ${workspaceId}, the reply names ${String(repliedId)}` });
  }
  const workspaceRef = nonEmptyString({ field: "workspace_ref", value });
  if (workspaceRef === undefined) {
    return malformedPanes({ detail: 'no string field "workspace_ref"' });
  }
  const panes = value["panes"];
  if (!Array.isArray(panes) || panes.length !== 1) {
    const count = Array.isArray(panes) ? String(panes.length) : "no";
    return malformedPanes({ detail: `expected exactly one pane, the reply carries ${count}` });
  }
  const pane: unknown = panes[0];
  if (!isRecord(pane)) {
    return malformedPanes({ detail: "the pane is not an object" });
  }
  const surfaceId = nonEmptyString({ field: "selected_surface_id", value: pane });
  const surfaceRef = nonEmptyString({ field: "selected_surface_ref", value: pane });
  if (surfaceId === undefined || surfaceRef === undefined) {
    return malformedPanes({ detail: "the pane names no selected surface" });
  }
  return ok({ surfaceId, surfaceRef, workspaceId, workspaceRef });
}

/**
 * `workspace.create`, decoded.
 *
 * @param call the socket call to issue it through
 * @returns the client's `createWorkspace`
 */
export function createWorkspaceOver({ call }: { call: CmuxCall }): CmuxClient["createWorkspace"] {
  return async ({ name, cwd, description }) =>
    (
      await call({
        method: "workspace.create",
        params: { cwd, ...(description === undefined ? {} : { description }), focus: false, name },
      })
    ).andThen((value) => parseCreatedWorkspace({ value }));
}

/**
 * `workspace.close`, carrying `force` on the wire only when the caller asked for it.
 *
 * @param call the socket call to issue it through
 * @returns the client's `closeWorkspace`
 */
export function closeWorkspaceOver({ call }: { call: CmuxCall }): CmuxClient["closeWorkspace"] {
  return async ({ workspaceId, force }) =>
    (
      await call({
        method: "workspace.close",
        params: { workspace_id: workspaceId, ...(force === true ? { force: true } : {}) },
      })
    ).map(() => undefined);
}

/**
 * `pane.list`, decoded into an existing workspace's four addresses.
 *
 * @param call the socket call to issue it through
 * @returns the client's `workspaceSurface`
 */
export function workspaceSurfaceOver({ call }: { call: CmuxCall }): CmuxClient["workspaceSurface"] {
  return async ({ workspaceId }) =>
    (await call({ method: PANE_LIST_METHOD, params: { workspace_id: workspaceId } })).andThen((value) =>
      parseWorkspaceSurface({ value, workspaceId }),
    );
}
