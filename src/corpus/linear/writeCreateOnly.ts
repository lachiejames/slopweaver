/**
 * The CREATE-ONLY slices of the Linear write API — a project status update, a comment and an issue relation.
 *
 * None of the three has an update arm, and each slice's own doc says why. They are mixed into the one write API
 * by `./write.ts`'s `makeLinearWriteApi`, which still owns the `LinearWriteApi` shape. Split out of `./write.ts`
 * under the file-size cap.
 */
import type { LinearWriteApi } from "./write.js";
import {
  CREATE_COMMENT_MUTATION,
  CREATE_PROJECT_UPDATE_MUTATION,
  CREATE_RELATION_MUTATION,
  DELETE_COMMENT_MUTATION,
  DELETE_PROJECT_UPDATE_MUTATION,
  DELETE_RELATION_MUTATION,
  deleteVia,
  mutateVia,
  READ_COMMENT_QUERY,
  READ_PROJECT_UPDATE_QUERY,
  READ_RELATION_QUERY,
  readVia,
  type SendContext,
} from "./writeGraphql.js";
import { readCommentFrom, readProjectUpdateFrom, readRelationFrom } from "./writeReadBack.js";

/**
 * The project STATUS UPDATE methods.
 *
 * Create-only, exactly like a comment and for the same reason: posting one notifies everyone watching the
 * project, and editing a message people have already been notified about is a different act with different
 * consequences. A correction is a NEW update, which is also how a human does it in Linear's own UI.
 *
 * @param ctx the shared send context
 * @returns the project-update slice of the write API
 */
export function projectUpdateApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<LinearWriteApi, "createProjectUpdate" | "deleteProjectUpdate" | "readProjectUpdate"> {
  return {
    createProjectUpdate: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "projectUpdateCreate",
        operation: "linear.projectUpdateCreate",
        node: "projectUpdate",
        query: CREATE_PROJECT_UPDATE_MUTATION,
        variables: { input: { ...input, id } },
      }),
    deleteProjectUpdate: ({ id }) =>
      deleteVia({
        ctx,
        field: "projectUpdateDelete",
        id,
        operation: "linear.projectUpdateDelete",
        query: DELETE_PROJECT_UPDATE_MUTATION,
      }),
    readProjectUpdate: ({ id }) =>
      readVia({
        ctx,
        id,
        operation: "linear.projectUpdate.readBack",
        query: READ_PROJECT_UPDATE_QUERY,
        shape: readProjectUpdateFrom,
      }),
  };
}

/**
 * The comment + relation methods.
 *
 * Both are CREATE-only on the write path, with no update arm at all, and that is a decision rather than an
 * omission. Linear's `commentUpdate` exists, but a comment is a message in an activity feed: editing one
 * silently rewrites what a colleague has already read and been notified about, and nothing in the product
 * asked for it. A relation has nothing to update — its identity IS its two endpoints and its type, so
 * "changing" one means deleting an edge and asserting another. The delete arms exist for test cleanup only,
 * exactly as `deleteIssue` does, and no CLI verb exposes either.
 *
 * @returns the comment and relation slice of the write API
 */
export function commentApi({
  ctx,
}: {
  ctx: SendContext;
}): Pick<
  LinearWriteApi,
  "createComment" | "createRelation" | "deleteComment" | "deleteRelation" | "readComment" | "readRelation"
> {
  return {
    createComment: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "commentCreate",
        operation: "linear.commentCreate",
        node: "comment",
        query: CREATE_COMMENT_MUTATION,
        variables: { input: { ...input, id } },
      }),
    createRelation: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "issueRelationCreate",
        operation: "linear.issueRelationCreate",
        node: "issueRelation",
        query: CREATE_RELATION_MUTATION,
        variables: { input: { ...input, id } },
      }),
    deleteComment: ({ id }) =>
      deleteVia({ ctx, field: "commentDelete", id, operation: "linear.commentDelete", query: DELETE_COMMENT_MUTATION }),
    deleteRelation: ({ id }) =>
      deleteVia({
        ctx,
        field: "issueRelationDelete",
        id,
        operation: "linear.issueRelationDelete",
        query: DELETE_RELATION_MUTATION,
      }),
    readComment: ({ id }) =>
      readVia({ ctx, id, operation: "linear.comment.readBack", query: READ_COMMENT_QUERY, shape: readCommentFrom }),
    readRelation: ({ id }) =>
      readVia({
        ctx,
        id,
        operation: "linear.issueRelation.readBack",
        query: READ_RELATION_QUERY,
        shape: readRelationFrom,
      }),
  };
}
