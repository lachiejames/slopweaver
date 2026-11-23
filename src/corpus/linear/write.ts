/**
 * The Linear MUTATION seam — create, update, read-back and delete, each through the door's provider call.
 *
 * Separate from `./fetch.ts` rather than bolted onto `LinearApi`, and not merely for tidiness: `LinearApi` is
 * a read-shaped paging interface, and every call in it is safe to repeat. These are not. The distinction is
 * carried in two places that a shared seam could not express:
 *
 *  - **The operation label.** `linear.rawRequest` maps to the `read` endpoint class. A mutation labelled with
 *    it would be classified as a read in the registry the rate ratchet reads, so the labels here are their
 *    own (`linear.issueCreate`, `linear.issueUpdate`, `linear.issueDelete`) and map to `write`.
 *  - **The retry posture.** Create, update and delete run `retryMode: "never"`. A create that times out may
 *    still have landed, so retrying it is how one intent becomes two tickets. Only the read-back retries.
 *
 * ## At-most-once, and why it is achievable here but not on Slack
 *
 * `IssueCreateInput.id` accepts a CALLER-CHOSEN UUID v4. So the id exists before the request does: a caller
 * reserves it locally, sends it, and if the response is lost it can ask Linear whether that exact id exists
 * rather than guessing from content. Slack has no equivalent, which is why its reservation can only ever say
 * "outcome unknown". Choosing the id is not this module's job — it takes one — but the whole design depends
 * on it, so it is stated here.
 *
 * ## Three ways a create "succeeds" without creating anything
 *
 * All three are checked, because each returns a shape that reads like success:
 *
 *  1. A GraphQL 200 carrying an `errors` array. Linear documents this explicitly.
 *  2. `success: false` in the payload.
 *  3. `success: true` with a NULL issue — `IssuePayload.issue` is `Maybe<Issue>` in the schema, so the type
 *     system permits it and only a runtime check catches it.
 *
 * The GraphQL transport and the payload-parsing this rests on live in `./writeGraphql.ts` (file-size ratchet
 * split): that file sends the round trip and turns a raw payload into a typed identity or a typed error; this
 * file owns the public `LinearWriteApi` shape and wires those pieces into it.
 *
 * Two more pieces were split out under the file-size cap: every read-back shaper lives in `./writeReadBack.ts`,
 * and the create-only slices (a project update, a comment, a relation) live in `./writeCreateOnly.ts`.
 */
import { LinearClient } from "@linear/sdk";

import type { IngestError } from "../../lib/ingestError.js";
import { scopeIdForToken } from "../../lib/providerCall.js";
import { createRateScheduler, type RateScheduler } from "../../lib/resilience.js";
import { okAsync, type ResultAsync } from "../../lib/result.js";
import type { LinearWritePrivacy } from "../../outbound/linear/writePrivacy.js";
import { LINEAR_RATE_PER_SEC, type LinearRequest } from "./transport.js";
import { commentApi, projectUpdateApi } from "./writeCreateOnly.js";
import {
  CREATE_MILESTONE_MUTATION,
  CREATE_MUTATION,
  CREATE_PROJECT_MUTATION,
  DELETE_MILESTONE_MUTATION,
  DELETE_MUTATION,
  DELETE_PROJECT_MUTATION,
  deleteVia,
  mutateVia,
  READ_MILESTONE_QUERY,
  READ_PROJECT_QUERY,
  READ_QUERY,
  readVia,
  type SendContext,
  UPDATE_MUTATION,
  UPDATE_PROJECT_MUTATION,
} from "./writeGraphql.js";
import { readIssueFrom, readMilestoneFrom, readProjectFrom } from "./writeReadBack.js";

/**
 * The identity a write hands back: an id, and nothing else.
 *
 * ONE type for every object kind, because `@linear/sdk`'s mutation payload fragments are uniform —
 * `__typename`, `lastSyncId`, `success`, and the written object as a bare `{ id }`. Our own mutations used
 * to echo an identifier, a URL, a name or a health in the same round trip; the SDK's do not, and there is no
 * selection to widen because the document is generated.
 *
 * That is not a loss of information, only a change of source. Every caller of this lane already reads the
 * object back at the id it chose — `src/cli/commands/linear/run.ts` says why in its own words, "the create's
 * own response is not proof" — and the SDK's read-back documents are RICHER than the ones they replace:
 * `IssueDocument` carries the whole `Issue` fragment where our `READ_QUERY` selected six fields.
 *
 * The one place this is felt is the unconfirmed path: a create whose read-back fails can now report only the
 * id it chose, where it used to name the identifier. See `run.ts`.
 */
export interface WrittenObject {
  readonly id: string;
}

/**
 * The mutation seam. Each method is one raw call, gated and labelled for what it does to the world.
 *
 * The ASSET lane is deliberately NOT here. It lives behind its own factory in `./writeAssets.ts` because
 * its operation is not one call — a reservation followed by a PUT to a storage bucket, a different host
 * outside this scheduler's rate block. Folding it in would also have made every existing fake of this
 * interface carry two methods it has no use for.
 */
export interface LinearWriteApi {
  /** Create an issue at a CALLER-CHOSEN id. Never retried: a lost response may still have created it. */
  createIssue(args: { id: string; input: Readonly<Record<string, unknown>> }): ResultAsync<WrittenObject, IngestError>;
  /** Replace fields on an existing issue. Never retried. */
  updateIssue(args: { id: string; input: Readonly<Record<string, unknown>> }): ResultAsync<WrittenObject, IngestError>;
  /** Read one issue back by id. The only repeatable call here, so the only one that retries. */
  readIssue(args: { id: string }): ResultAsync<ReadIssue | undefined, IngestError>;
  /** Delete an issue. Linear moves it to Recently Deleted for 30 days; it is not erased. */
  deleteIssue(args: { id: string }): ResultAsync<boolean, IngestError>;
  /** Create a project at a CALLER-CHOSEN id. Never retried: a lost response may still have created it. */
  createProject(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Replace fields on an existing project. Never retried. */
  updateProject(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one project back by id. Retries transiently, same as `readIssue`. */
  readProject(args: { id: string }): ResultAsync<ReadProject | undefined, IngestError>;
  /** Create a milestone at a CALLER-CHOSEN id. Never retried. */
  createMilestone(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one milestone back by id. Retries transiently. */
  readMilestone(args: { id: string }): ResultAsync<ReadMilestone | undefined, IngestError>;
  /** Delete a project. TEST-CLEANUP ONLY — no CLI verb exposes this, same as `deleteIssue`. Linear moves it
   * to trash; it is not erased. */
  deleteProject(args: { id: string }): ResultAsync<boolean, IngestError>;
  /** Delete a milestone. TEST-CLEANUP ONLY — no CLI verb exposes this. */
  deleteMilestone(args: { id: string }): ResultAsync<boolean, IngestError>;
  /** Create a comment at a CALLER-CHOSEN id. Never retried: a lost response may still have posted it. */
  createComment(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one comment back by id. Retries transiently, same posture as `readIssue`. */
  readComment(args: { id: string }): ResultAsync<ReadComment | undefined, IngestError>;
  /** Delete a comment. TEST-CLEANUP ONLY — no CLI verb exposes this. */
  deleteComment(args: { id: string }): ResultAsync<boolean, IngestError>;
  /**
   * Post a project STATUS UPDATE at a CALLER-CHOSEN id. Never retried: a lost response may still have posted
   * it, and every member watching the project is notified when it does.
   *
   * Not to be confused with `updateProject`, which edits the project itself. Linear names the mutation
   * `projectUpdateCreate` and the project editor `projectUpdate`, so the two read almost identically at a
   * glance — see `./writeGraphql.ts`'s `PROJECT_UPDATE_FIELDS`.
   */
  createProjectUpdate(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one project update back by id. Retries transiently, same posture as `readComment`. */
  readProjectUpdate(args: { id: string }): ResultAsync<ReadProjectUpdate | undefined, IngestError>;
  /** Delete a project update. TEST-CLEANUP ONLY — no CLI verb exposes this. */
  deleteProjectUpdate(args: { id: string }): ResultAsync<boolean, IngestError>;
  /** Create an issue relation at a CALLER-CHOSEN id. Never retried. */
  createRelation(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one relation back by id. Retries transiently. */
  readRelation(args: { id: string }): ResultAsync<ReadRelation | undefined, IngestError>;
  /** Delete a relation. TEST-CLEANUP ONLY — no CLI verb exposes this. */
  deleteRelation(args: { id: string }): ResultAsync<boolean, IngestError>;
}

/** What a comment read-back yields. `body` is the stored markdown, which the fidelity check compares. */
export interface ReadComment {
  readonly id: string;
  readonly url: string;
  readonly body: string | undefined;
  readonly updatedAt: string;
}

/** What a project-update read-back yields. `body` is the stored markdown, which the fidelity check compares. */
export interface ReadProjectUpdate {
  readonly id: string;
  readonly url: string;
  readonly health: string;
  readonly body: string | undefined;
  readonly updatedAt: string;
}

/**
 * A relation as the READ-BACK yields it, with the pair it actually joined.
 *
 * The create no longer echoes this: `IssueRelationPayload` selects `issueRelation { id }`, so both endpoints
 * are established by reading the relation back — which is what made the read-back worth performing anyway,
 * since a relation whose `relatedIssue` came back null joined nothing.
 */
export interface WrittenRelation {
  readonly id: string;
  readonly type: string;
  readonly issueId: string;
  readonly relatedIssueId: string;
}

/** What a relation read-back yields. Identical to what the create echoes — a relation carries no body. */
export type ReadRelation = WrittenRelation;

/**
 * What a read-back yields. `description` is the stored markdown, which `update` compares against.
 *
 * `description` is `string | undefined` rather than defaulting to `""`, and the distinction is load-bearing:
 * `""` means Linear stored an empty description, `undefined` means it returned none at all. Collapsing them
 * would let a failed read look like an empty ticket, and `update` decides whether to overwrite by comparing
 * exactly this value.
 */
export interface ReadIssue {
  readonly id: string;
  readonly identifier: string;
  readonly url: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly updatedAt: string;
}

/** What a project read-back yields. `description` and `targetDate` are Linear's stored values, not what was sent. */
export interface ReadProject {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly slugId: string;
  readonly description: string | undefined;
  readonly targetDate: string | undefined;
  readonly updatedAt: string;
}

/**
 * What a milestone read-back yields.
 *
 * `projectUrl` is the one field the milestone document cannot supply. `@linear/sdk`'s `ProjectMilestone`
 * fragment selects `project { id }` and nothing else, so the url comes from ONE follow-up read of that
 * project — see `milestoneApi`'s `readMilestone`. It is `undefined` only when that follow-up found no
 * project at the id the milestone points at, which is an anomaly worth reporting rather than hiding: the
 * milestone itself was still read, and reporting it as missing would be a different, false claim.
 */
export interface ReadMilestone {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectUrl: string | undefined;
  readonly description: string | undefined;
  readonly targetDate: string | undefined;
  readonly updatedAt: string;
}

/** The four issue methods, split out so `makeLinearWriteApi` stays under the complexity cap. */
function issueApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<LinearWriteApi, "createIssue" | "deleteIssue" | "readIssue" | "updateIssue"> {
  return {
    createIssue: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "issueCreate",
        operation: "linear.issueCreate",
        node: "issue",
        query: CREATE_MUTATION,
        // The caller-chosen id rides INSIDE the input, which is what makes the create addressable before it
        // is acknowledged. A caller that omitted it would get a server id and lose at-most-once entirely.
        variables: { input: { ...input, id } },
      }),
    deleteIssue: ({ id }) =>
      deleteVia({ ctx, field: "issueDelete", id, operation: "linear.issueDelete", query: DELETE_MUTATION }),
    readIssue: ({ id }) =>
      readVia({ ctx, id, operation: "linear.issue.readBack", query: READ_QUERY, shape: readIssueFrom }),
    updateIssue: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "issueUpdate",
        operation: "linear.issueUpdate",
        node: "issue",
        query: UPDATE_MUTATION,
        variables: { id, input },
      }),
  };
}

/** The project methods. Split from the milestone ones only to keep each function under the line cap. */
function projectApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<LinearWriteApi, "createProject" | "deleteProject" | "readProject" | "updateProject"> {
  return {
    createProject: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "projectCreate",
        operation: "linear.projectCreate",
        node: "project",
        query: CREATE_PROJECT_MUTATION,
        variables: { input: { ...input, id } },
      }),
    deleteProject: ({ id }) =>
      deleteVia({ ctx, field: "projectDelete", id, operation: "linear.projectDelete", query: DELETE_PROJECT_MUTATION }),
    readProject: ({ id }) =>
      readVia({ ctx, id, operation: "linear.project.readBack", query: READ_PROJECT_QUERY, shape: readProjectFrom }),
    updateProject: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "projectUpdate",
        operation: "linear.projectUpdate",
        node: "project",
        query: UPDATE_PROJECT_MUTATION,
        variables: { id, input },
      }),
  };
}

/** The milestone methods. Create-only on the write path — see `../../cli/commands/linear/milestoneCore.ts`. */
function milestoneApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<LinearWriteApi, "createMilestone" | "deleteMilestone" | "readMilestone"> {
  return {
    createMilestone: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "projectMilestoneCreate",
        operation: "linear.projectMilestoneCreate",
        node: "projectMilestone",
        query: CREATE_MILESTONE_MUTATION,
        variables: { input: { ...input, id } },
      }),
    deleteMilestone: ({ id }) =>
      deleteVia({
        ctx,
        field: "projectMilestoneDelete",
        id,
        operation: "linear.projectMilestoneDelete",
        query: DELETE_MILESTONE_MUTATION,
      }),
    // TWO round trips, and the second is not optional: `ProjectMilestone` selects `project { id }`, so the
    // url `linear milestone` prints has to come from the project's own document. It is skipped entirely when
    // the milestone is absent, so a "not found" answer still costs one request.
    readMilestone: ({ id }) =>
      readVia({
        ctx,
        id,
        operation: "linear.projectMilestone.readBack",
        query: READ_MILESTONE_QUERY,
        shape: readMilestoneFrom,
      }).andThen((milestone) => {
        if (milestone === undefined) {
          return okAsync<ReadMilestone | undefined, IngestError>(undefined);
        }
        return readVia({
          ctx,
          id: milestone.projectId,
          operation: "linear.project.readBack",
          query: READ_PROJECT_QUERY,
          shape: readProjectFrom,
        }).map((project): ReadMilestone => ({ ...milestone, projectUrl: project?.url }));
      }),
  };
}

/**
 * The ONE Linear WRITE send context, bound to a token — the client, the pacer and the quota scope every
 * mutation lane here shares.
 *
 * Its own exported function rather than a private step inside {@link makeLinearWriteApi}, because there are
 * now four write lanes (this file's, `./writeAssets.ts`'s, `./writeInitiative.ts`'s and `./writeDocument.ts`'s)
 * and they must not become four clients. `schedulerBypass`'s own doc states the reason as a rule: Linear's quota is per-USER,
 * so a pacer that cannot see every request cannot hold the budget — and the same gate keeps the list of
 * files allowed to build a client short precisely so a reader auditing "what can this program talk to?" has
 * one place to look per provider lane.
 *
 * The READ seam cannot be reused for any of them: it labels every call `linear.rawRequest` (endpoint class
 * `read`) and retries transiently, and an irreversible create must carry a mutation label and never retry.
 *
 * @param token the token the writes are made as
 * @param request the GraphQL transport seam; omit for the production `rawRequest`
 * @param scheduler the shared rate scheduler; omit for the production one
 * @param privacy the outbound privacy policy every mutation is judged under, built from the verb's own home and
 *   never defaulted, so no write lane can reach an ambient one
 * @returns the send context every mutation in this provider's write lanes goes through
 */
export function makeLinearSendContext({
  token,
  request,
  scheduler,
  privacy,
}: {
  token: string;
  request?: LinearRequest | undefined;
  scheduler?: RateScheduler | undefined;
  privacy: LinearWritePrivacy;
}): SendContext {
  // devlint: sdk-factory -- the Linear WRITE lane: mutation labels + a never-retry posture, shared by all three
  const client = new LinearClient({ apiKey: token });
  return {
    client,
    gate: scheduler ?? createRateScheduler({ ratePerSec: LINEAR_RATE_PER_SEC }),
    privacy,
    request,
    scopeId: scopeIdForToken({ token }),
  };
}

/**
 * The Linear write API, bound to a token.
 *
 * @param token the token the writes are made as
 * @param request the GraphQL transport seam; omit for the production `rawRequest`
 * @param scheduler the shared rate scheduler; omit for the production one, which is what keeps these writes
 *   inside the same rate block as every other Linear call
 * @param privacy the outbound privacy policy every mutation is judged under, from the verb's own home
 * @returns the write API
 */
export function makeLinearWriteApi({
  token,
  request,
  scheduler,
  privacy,
}: {
  token: string;
  request?: LinearRequest;
  scheduler?: RateScheduler;
  privacy: LinearWritePrivacy;
}): LinearWriteApi {
  const ctx = makeLinearSendContext({ privacy, request, scheduler, token });
  return {
    ...issueApi({ ctx }),
    ...projectApi({ ctx }),
    ...milestoneApi({ ctx }),
    ...commentApi({ ctx }),
    ...projectUpdateApi({ ctx }),
  };
}
