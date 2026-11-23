/**
 * The LABEL lane of the Linear write API — creating an issue label or a project label.
 *
 * Its own lane rather than more methods on `./write.ts`'s `LinearWriteApi`, for the reason
 * `./writeInitiative.ts` records: one narrowly used verb should not force two irrelevant methods into every
 * fake of the broad seam. It shares the ONE send context
 * (`makeLinearSendContext`), so the pacer still sees every request.
 *
 * Create and delete never retry, because a lost create may still have landed. That is safe to say because
 * `IssueLabelCreateInput.id` and `ProjectLabelCreateInput.id` both accept a CALLER-CHOSEN UUID
 * (`@linear/sdk` 95.2.0), so the read-back asks about the exact id the create sent. The create documents echo
 * `{ id }` only, so the name, team and group a label actually got come from that read-back.
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

export const CREATE_ISSUE_LABEL_MUTATION = String(LinearDocument.CreateIssueLabelDocument);
export const READ_ISSUE_LABEL_QUERY = String(LinearDocument.IssueLabelDocument);
/** @internal — sent by this file's own delete; nothing outside names it. */
export const DELETE_ISSUE_LABEL_MUTATION = String(LinearDocument.DeleteIssueLabelDocument);

export const CREATE_PROJECT_LABEL_MUTATION = String(LinearDocument.CreateProjectLabelDocument);
/** @internal — sent by this file's own read-back; nothing outside names it. */
export const READ_PROJECT_LABEL_QUERY = String(LinearDocument.ProjectLabelDocument);
/** @internal — sent by this file's own delete; nothing outside names it. */
export const DELETE_PROJECT_LABEL_MUTATION = String(LinearDocument.DeleteProjectLabelDocument);

/** Which vocabulary a label belongs to. */
export type LinearLabelKind = "issue" | "project";

/**
 * A label as the READ-BACK yields it.
 *
 * `teamId` is `undefined` for a workspace label, which is Linear's own encoding (`team: null`) rather than
 * a missing read. `groupType` is `undefined` on every project label, whose fragment does not carry it.
 */
export interface ReadLinearLabel {
  readonly id: string;
  readonly kind: LinearLabelKind;
  readonly name: string;
  readonly teamId: string | undefined;
  readonly parentId: string | undefined;
  readonly isGroup: boolean;
  readonly groupType: string | undefined;
}

/** The id under a nested `{ id }` reference, or `undefined` when the reference is null or absent. Pure. */
function nestedId({ node, key }: { node: Record<string, unknown>; key: string }): string | undefined {
  const ref = node[key];
  return isRecord(ref) ? str({ key: "id", node: ref }) : undefined;
}

/**
 * Shape a label read-back from the root field the document answers under. A MISSING label is `undefined`
 * rather than an error, for the reason `./writeReadBack.ts`'s `readIssueFrom` records: "this id does not exist"
 * is a real answer to a reconciliation question.
 *
 * @param data the raw GraphQL data
 * @param kind which vocabulary was read, which names the root field (`issueLabel` or `projectLabel`)
 * @returns the label, or undefined when Linear has no such id or the node lacks an id or name
 */
export function readLabelFrom({ data, kind }: { data: unknown; kind: LinearLabelKind }): ReadLinearLabel | undefined {
  const node = isRecord(data) ? data[kind === "issue" ? "issueLabel" : "projectLabel"] : undefined;
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ key: "id", node });
  const name = str({ key: "name", node });
  if (id === undefined || name === undefined) {
    return undefined;
  }
  return {
    groupType: str({ key: "groupType", node }),
    id,
    isGroup: node["isGroup"] === true,
    kind,
    name,
    parentId: nestedId({ key: "parent", node }),
    teamId: nestedId({ key: "team", node }),
  };
}

/** The label methods. Create-only on the write path; the delete arms are test cleanup and no verb exposes them. */
export interface LinearLabelWriteApi {
  /** Create an issue label at a CALLER-CHOSEN id. Never retried. */
  createIssueLabel(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one issue label back by id. Retries transiently. */
  readIssueLabel(args: { id: string }): ResultAsync<ReadLinearLabel | undefined, IngestError>;
  /** Delete an issue label. TEST-CLEANUP ONLY. */
  deleteIssueLabel(args: { id: string }): ResultAsync<boolean, IngestError>;
  /** Create a project label at a CALLER-CHOSEN id. Never retried. */
  createProjectLabel(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one project label back by id. Retries transiently. */
  readProjectLabel(args: { id: string }): ResultAsync<ReadLinearLabel | undefined, IngestError>;
  /** Delete a project label. TEST-CLEANUP ONLY. */
  deleteProjectLabel(args: { id: string }): ResultAsync<boolean, IngestError>;
}

/** The issue-label methods. */
function issueLabelApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<LinearLabelWriteApi, "createIssueLabel" | "deleteIssueLabel" | "readIssueLabel"> {
  return {
    createIssueLabel: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "issueLabelCreate",
        node: "issueLabel",
        operation: "linear.issueLabelCreate",
        query: CREATE_ISSUE_LABEL_MUTATION,
        // `replaceTeamLabels` is never sent: it would retire every team label of the same name across the
        // workspace, which is a migration, not a create.
        variables: { input: { ...input, id } },
      }),
    deleteIssueLabel: ({ id }) =>
      deleteVia({
        ctx,
        field: "issueLabelDelete",
        id,
        operation: "linear.issueLabelDelete",
        query: DELETE_ISSUE_LABEL_MUTATION,
      }),
    readIssueLabel: ({ id }) =>
      readVia({
        ctx,
        id,
        operation: "linear.issueLabel.readBack",
        query: READ_ISSUE_LABEL_QUERY,
        shape: ({ data }) => readLabelFrom({ data, kind: "issue" }),
      }),
  };
}

/** The project-label methods. */
function projectLabelApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<LinearLabelWriteApi, "createProjectLabel" | "deleteProjectLabel" | "readProjectLabel"> {
  return {
    createProjectLabel: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "projectLabelCreate",
        node: "projectLabel",
        operation: "linear.projectLabelCreate",
        query: CREATE_PROJECT_LABEL_MUTATION,
        variables: { input: { ...input, id } },
      }),
    deleteProjectLabel: ({ id }) =>
      deleteVia({
        ctx,
        field: "projectLabelDelete",
        id,
        operation: "linear.projectLabelDelete",
        query: DELETE_PROJECT_LABEL_MUTATION,
      }),
    readProjectLabel: ({ id }) =>
      readVia({
        ctx,
        id,
        operation: "linear.projectLabel.readBack",
        query: READ_PROJECT_LABEL_QUERY,
        shape: ({ data }) => readLabelFrom({ data, kind: "project" }),
      }),
  };
}

/**
 * The Linear label write API, bound to a token.
 *
 * @param token the token the writes are made as
 * @param request the GraphQL transport seam; omit for the production `rawRequest`
 * @param scheduler the shared rate scheduler; omit for the production one
 * @param privacy the outbound privacy policy every mutation is judged under, from the verb's own home
 * @returns the label write API
 */
export function makeLinearLabelWriteApi({
  token,
  request,
  scheduler,
  privacy,
}: {
  token: string;
  request?: LinearRequest;
  scheduler?: RateScheduler;
  privacy: LinearWritePrivacy;
}): LinearLabelWriteApi {
  const ctx = makeLinearSendContext({ privacy, request, scheduler, token });
  return { ...issueLabelApi({ ctx }), ...projectLabelApi({ ctx }) };
}
