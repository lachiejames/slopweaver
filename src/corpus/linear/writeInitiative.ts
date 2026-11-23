/**
 * The INITIATIVE lane of the Linear write API — the strategy layer above projects.
 *
 * Split from `./write.ts` and `./writeGraphql.ts` rather than added to either, for the `file-size-ratchet`
 * cap: three object kinds (the initiative, its status update, and the edge that joins a project to it) with
 * their own mutations, read-backs and false-success parsers is a lane's worth of code, and this file is that
 * lane's whole surface.
 *
 * ## Three kinds, and which of them can be edited
 *
 * An initiative CAN be updated, and this lane exposes that arm — unlike a comment or a project update,
 * editing an initiative's name, owner, status or target date changes a plan rather than rewriting a message
 * someone has already been notified about. Its status UPDATE cannot, for exactly the reason
 * `./writeCreateOnly.ts`'s `projectUpdateApi` records: everyone watching has already read it, and a correction is a
 * new update. The project LINK cannot either — its identity is its two endpoints, so "changing" one means
 * deleting an edge and asserting another, the same call `createRelation` makes.
 */
import { LinearDocument } from "@linear/sdk";

import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { type RateScheduler } from "../../lib/resilience.js";
import { type ResultAsync } from "../../lib/result.js";

import type { LinearWritePrivacy } from "../../outbound/linear/writePrivacy.js";
import { type LinearRequest } from "./transport.js";
import { makeLinearSendContext, type WrittenObject } from "./write.js";
import { deleteVia, mutateVia, readVia, type SendContext, str } from "./writeGraphql.js";

/**
 * What an initiative read-back yields.
 *
 * Its own shape rather than an extension of what the CREATE returns, because under `@linear/sdk` the create
 * returns `{ id }` and nothing else — see the document bindings below. `description` is
 * `string | undefined` rather than defaulting to `""`, exactly as `./write.ts`'s `ReadIssue` is and for the
 * reason stated there: `""` means Linear stored an empty description, `undefined` means it returned none at
 * all, and collapsing them would let a failed read look like an emptied initiative.
 */
export interface ReadInitiative {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly slugId: string;
  readonly description: string | undefined;
  readonly targetDate: string | undefined;
  readonly status: string | undefined;
  readonly updatedAt: string;
}

/**
 * What an initiative-update read-back yields.
 *
 * `body` is the stored markdown the fidelity check compares; `health` is the field a reader of the update
 * acts on, and the only one Linear could store differently from what was asked.
 */
export interface ReadInitiativeUpdate {
  readonly id: string;
  readonly url: string;
  readonly health: string;
  readonly body: string | undefined;
  readonly updatedAt: string;
}

/** What a link read-back yields: the edge's own id, plus the pair it joined. */
export interface ReadInitiativeLink {
  readonly id: string;
  readonly initiativeId: string;
  readonly projectId: string;
}

/**
 * Every document this lane sends, bound to `@linear/sdk`'s own generated operation — the same binding
 * `./writeGraphql.ts` makes for the issue, project, comment and relation lanes, and the same two
 * consequences apply here.
 *
 * **The mutation payloads echo `{ id }` and nothing else.** `InitiativePayload`, `InitiativeUpdatePayload`
 * and `InitiativeToProjectPayload` select `__typename`, `lastSyncId`, `success` and the written object's
 * bare id, where our own mutations returned `id name url slugId`. So this lane's three identity parsers
 * collapse into `./writeGraphql.ts`'s single `identityFrom` and its three `Written*` types into
 * `WrittenObject`; a name, URL or health now comes from the READ-BACK, which both initiative verbs already
 * perform at the id they chose because "the mutation's own response is not proof".
 *
 * **The read-back documents are richer than the ones they replace.** `InitiativeDocument` carries the whole
 * `Initiative` fragment — `health`, `priority`, `content`, `documentContent` and every other scalar — where
 * `READ_INITIATIVE_QUERY` selected eight fields. Nothing is lost on the read side; there is simply more.
 *
 * Note the naming collision the SDK makes sharper rather than softer, the same one `./writeGraphql.ts`
 * records for `projectUpdate`: `initiativeUpdate` is BOTH the root query that reads an initiative's status
 * update AND the root mutation that edits an INITIATIVE. The SDK resolves it by word order —
 * `InitiativeUpdateDocument` reads a status update, `UpdateInitiativeDocument` edits an initiative — so the
 * two differ by nothing else, and a transposition compiles.
 */
export const CREATE_INITIATIVE_MUTATION = String(LinearDocument.CreateInitiativeDocument);
export const UPDATE_INITIATIVE_MUTATION = String(LinearDocument.UpdateInitiativeDocument);
export const READ_INITIATIVE_QUERY = String(LinearDocument.InitiativeDocument);
export const DELETE_INITIATIVE_MUTATION = String(LinearDocument.DeleteInitiativeDocument);

export const CREATE_INITIATIVE_UPDATE_MUTATION = String(LinearDocument.CreateInitiativeUpdateDocument);
export const READ_INITIATIVE_UPDATE_QUERY = String(LinearDocument.InitiativeUpdateDocument);
export const ARCHIVE_INITIATIVE_UPDATE_MUTATION = String(LinearDocument.ArchiveInitiativeUpdateDocument);

export const CREATE_INITIATIVE_LINK_MUTATION = String(LinearDocument.CreateInitiativeToProjectDocument);
export const READ_INITIATIVE_LINK_QUERY = String(LinearDocument.InitiativeToProjectDocument);
export const DELETE_INITIATIVE_LINK_MUTATION = String(LinearDocument.DeleteInitiativeToProjectDocument);

/** The link's two endpoints, read from the nested references the read-back echoes. */
function linkFrom({ node }: { node: Record<string, unknown> }): ReadInitiativeLink | undefined {
  const id = str({ key: "id", node });
  const initiative = node["initiative"];
  const project = node["project"];
  const initiativeId = isRecord(initiative) ? str({ key: "id", node: initiative }) : undefined;
  const projectId = isRecord(project) ? str({ key: "id", node: project }) : undefined;
  if (id === undefined || initiativeId === undefined || projectId === undefined) {
    return undefined;
  }
  return { id, initiativeId, projectId };
}

/**
 * Shape an initiative read-back. A MISSING initiative is `undefined` rather than an error, for the reason
 * `./writeReadBack.ts`'s `readIssueFrom` records: "this id does not exist" is a real answer.
 *
 * @param data the raw GraphQL data
 * @returns the initiative, or undefined when Linear has no such id
 */
export function readInitiativeFrom({ data }: { data: unknown }): ReadInitiative | undefined {
  const node = isRecord(data) ? data["initiative"] : undefined;
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ key: "id", node });
  const name = str({ key: "name", node });
  const url = str({ key: "url", node });
  const slugId = str({ key: "slugId", node });
  const updatedAt = str({ key: "updatedAt", node });
  if (id === undefined || name === undefined || url === undefined || slugId === undefined || updatedAt === undefined) {
    return undefined;
  }
  // `description` is read RAW rather than through `str`, which collapses `""` to undefined: the same call
  // `./writeReadBack.ts`'s `readIssueFrom` makes, and for the same reason — `""` means Linear stored an empty
  // description, `undefined` means it returned none, and a caller comparing what it sent needs the two apart.
  const rawDescription = node["description"];
  return {
    description: typeof rawDescription === "string" ? rawDescription : undefined,
    id,
    name,
    slugId,
    status: str({ key: "status", node }),
    targetDate: str({ key: "targetDate", node }),
    updatedAt,
    url,
  };
}

/**
 * Shape an initiative-update read-back.
 *
 * @param data the raw GraphQL data
 * @returns the update, or undefined when Linear has no such id
 */
export function readInitiativeUpdateFrom({ data }: { data: unknown }): ReadInitiativeUpdate | undefined {
  const node = isRecord(data) ? data["initiativeUpdate"] : undefined;
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ key: "id", node });
  const url = str({ key: "url", node });
  const health = str({ key: "health", node });
  const updatedAt = str({ key: "updatedAt", node });
  if (id === undefined || url === undefined || health === undefined || updatedAt === undefined) {
    return undefined;
  }
  return { body: str({ key: "body", node }), health, id, updatedAt, url };
}

/**
 * Shape a link read-back.
 *
 * @param data the raw GraphQL data
 * @returns the link, or undefined when Linear has no such id
 */
export function readInitiativeLinkFrom({ data }: { data: unknown }): ReadInitiativeLink | undefined {
  const node = isRecord(data) ? data["initiativeToProject"] : undefined;
  return isRecord(node) ? linkFrom({ node }) : undefined;
}

/** The initiative methods, exposed as their own seam for the reason this module's doc records. */
export interface LinearInitiativeWriteApi {
  /** Create an initiative at a CALLER-CHOSEN id. Never retried: a lost response may still have created it. */
  createInitiative(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Replace fields on an existing initiative. Never retried. */
  updateInitiative(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one initiative back by id. Retries transiently, the same posture every read-back here takes. */
  readInitiative(args: { id: string }): ResultAsync<ReadInitiative | undefined, IngestError>;
  /** Delete an initiative. TEST-CLEANUP ONLY — no CLI verb exposes this, same as `deleteIssue`. */
  deleteInitiative(args: { id: string }): ResultAsync<boolean, IngestError>;
  /** Post an initiative STATUS UPDATE at a CALLER-CHOSEN id. Never retried — it notifies every watcher. */
  createInitiativeUpdate(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one initiative update back by id. Retries transiently. */
  readInitiativeUpdate(args: { id: string }): ResultAsync<ReadInitiativeUpdate | undefined, IngestError>;
  /**
   * Archive an initiative update. TEST-CLEANUP ONLY — no CLI verb exposes this.
   *
   * ARCHIVE, not delete: Linear ships `initiativeUpdateArchive` and no `initiativeUpdateDelete` at all, so
   * this is the only teardown the provider offers for the kind. Confirmed against the live schema.
   */
  archiveInitiativeUpdate(args: { id: string }): ResultAsync<boolean, IngestError>;
  /** Join a project to an initiative at a CALLER-CHOSEN id. Never retried. */
  createInitiativeLink(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one link back by id. Retries transiently. */
  readInitiativeLink(args: { id: string }): ResultAsync<ReadInitiativeLink | undefined, IngestError>;
  /** Delete a link. TEST-CLEANUP ONLY — no CLI verb exposes this. */
  deleteInitiativeLink(args: { id: string }): ResultAsync<boolean, IngestError>;
}

/** The initiative object's own four methods, split out so each factory stays under the line cap. */
function initiativeObjectApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<LinearInitiativeWriteApi, "createInitiative" | "deleteInitiative" | "readInitiative" | "updateInitiative"> {
  return {
    createInitiative: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "initiativeCreate",
        node: "initiative",
        operation: "linear.initiativeCreate",
        query: CREATE_INITIATIVE_MUTATION,
        // The caller-chosen id rides INSIDE the input, exactly as `./write.ts`'s creates do — that is what
        // makes the write addressable before it is acknowledged.
        variables: { input: { ...input, id } },
      }),
    deleteInitiative: ({ id }) =>
      deleteVia({
        ctx,
        field: "initiativeDelete",
        id,
        operation: "linear.initiativeDelete",
        query: DELETE_INITIATIVE_MUTATION,
      }),
    readInitiative: ({ id }) =>
      readVia({
        ctx,
        id,
        operation: "linear.initiative.readBack",
        query: READ_INITIATIVE_QUERY,
        shape: readInitiativeFrom,
      }),
    updateInitiative: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "initiativeUpdate",
        node: "initiative",
        operation: "linear.initiativeUpdate",
        query: UPDATE_INITIATIVE_MUTATION,
        variables: { id, input },
      }),
  };
}

/** The status-update methods. Create-only on the write path; the archive arm is test cleanup. */
function initiativeUpdateApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<LinearInitiativeWriteApi, "archiveInitiativeUpdate" | "createInitiativeUpdate" | "readInitiativeUpdate"> {
  return {
    archiveInitiativeUpdate: ({ id }) =>
      deleteVia({
        ctx,
        field: "initiativeUpdateArchive",
        id,
        operation: "linear.initiativeUpdateArchive",
        query: ARCHIVE_INITIATIVE_UPDATE_MUTATION,
      }),
    createInitiativeUpdate: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "initiativeUpdateCreate",
        node: "initiativeUpdate",
        operation: "linear.initiativeUpdateCreate",
        query: CREATE_INITIATIVE_UPDATE_MUTATION,
        variables: { input: { ...input, id } },
      }),
    readInitiativeUpdate: ({ id }) =>
      readVia({
        ctx,
        id,
        operation: "linear.initiativeUpdate.readBack",
        query: READ_INITIATIVE_UPDATE_QUERY,
        shape: readInitiativeUpdateFrom,
      }),
  };
}

/** The project→initiative LINK methods. Split from the update ones only to keep each under the line cap. */
function initiativeLinkApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<LinearInitiativeWriteApi, "createInitiativeLink" | "deleteInitiativeLink" | "readInitiativeLink"> {
  return {
    createInitiativeLink: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "initiativeToProjectCreate",
        node: "initiativeToProject",
        operation: "linear.initiativeToProjectCreate",
        query: CREATE_INITIATIVE_LINK_MUTATION,
        variables: { input: { ...input, id } },
      }),
    deleteInitiativeLink: ({ id }) =>
      deleteVia({
        ctx,
        field: "initiativeToProjectDelete",
        id,
        operation: "linear.initiativeToProjectDelete",
        query: DELETE_INITIATIVE_LINK_MUTATION,
      }),
    readInitiativeLink: ({ id }) =>
      readVia({
        ctx,
        id,
        operation: "linear.initiativeToProject.readBack",
        query: READ_INITIATIVE_LINK_QUERY,
        shape: readInitiativeLinkFrom,
      }),
  };
}

/**
 * The Linear INITIATIVE write API, bound to a token.
 *
 * Its own factory rather than a slice of `makeLinearWriteApi`, so every existing fake of `LinearWriteApi`
 * stays valid — an interface that grows by ten methods forces a change on every test that builds one, and
 * this lane's callers are the two initiative verbs and nothing else. The client, pacer and quota scope still
 * come from `./write.ts`'s `makeLinearSendContext`: separate API, one client, because Linear's quota is
 * per-USER and a second pacer over one budget holds neither half of it.
 *
 * @param token the token the writes are made as
 * @param request the GraphQL transport seam; omit for the production `rawRequest`
 * @param scheduler the shared rate scheduler; omit for the production one, which is what keeps these writes
 *   inside the same rate block as every other Linear call
 * @param privacy the outbound privacy policy every mutation is judged under, from the verb's own home
 * @returns the initiative write API
 */
export function makeLinearInitiativeWriteApi({
  token,
  request,
  scheduler,
  privacy,
}: {
  token: string;
  request?: LinearRequest;
  scheduler?: RateScheduler;
  privacy: LinearWritePrivacy;
}): LinearInitiativeWriteApi {
  const ctx = makeLinearSendContext({ privacy, request, scheduler, token });
  return { ...initiativeObjectApi({ ctx }), ...initiativeUpdateApi({ ctx }), ...initiativeLinkApi({ ctx }) };
}
