/**
 * INTEGRATION test: the Linear COMMENT + ISSUE-RELATION write seams against the REAL Linear GraphQL API,
 * recorded + replayed via a Polly cassette — the same rationale `linearWrite.test.ts` states for the issue
 * seam, extended rather than re-derived.
 *
 * Recording this CREATES TWO REAL ISSUES in the real workspace, comments on one, relates them, and deletes
 * everything again. Same reasoning as the issue cassette: a throwaway workspace would be evidence of
 * nothing, so the only honest recording is against the workspace the product actually targets.
 *
 * ## The sequence, and why each step is here
 *
 *   create issue A → create issue B → comment on A → read comment back → relate A→B → read relation back →
 *   delete relation → delete comment → delete both issues
 *
 * Two issues rather than one because a relation needs two endpoints and a self-relation is refused — by this
 * repo's own form, before the provider ever sees it (`commentSchema.ts`).
 *
 * `commentCreate` alone proves nothing: `CommentPayload.comment` is `Maybe<Comment>`, the same false-success
 * shape `identityFrom` guards against for issues. The read-back is what establishes an object exists at the
 * id we chose. Every delete is asserted rather than fired and forgotten, for the reason the issue cassette
 * records: an unrecorded teardown is how a re-record leaves permanent litter in the real workspace.
 *
 * ## What may be asserted, and what may not
 *
 * Same constraint as `linearWrite.test.ts`: the cassette redactor blanks every non-allowlisted string, so no
 * assertion may depend on a value Linear echoes back as TEXT — a comment's `body` included. What survives is
 * booleans, `type` (an allowlisted structural key, which is what makes the relation's direction assertable),
 * and REFERENTIAL EQUALITY between an id one call returns and the id a LATER call echoes back. That last one
 * is what this test is actually built around: the relation's two endpoints must be the two issue ids we
 * chose, in that order, which is the whole meaning of a directed `blocks` edge.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… \
 *     SLOPWEAVER_RECORD_LINEAR_TOKEN=lin_api_… \
 *     SLOPWEAVER_RECORD_LINEAR_TEAM=<team uuid> yarn test:integration        # (re)record — WRITES FOR REAL
 */
import { describe, expect, it } from "vitest";

import { commentIntentId } from "../../cli/commands/linear/commentCore.js";
import { relationIntentId } from "../../cli/commands/linear/relationCore.js";
import { makeLinearWriteApi } from "../../corpus/linear/write.js";
import type { LinearCommentForm, LinearRelationForm } from "../../outbound/linear/commentTypes.js";
import { renderCommentBody } from "../../outbound/linear/render.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../linearWritePrivacyFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function linearToken(): string {
  if (!RECORD) {
    return "lin_api_replay-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_LINEAR_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TOKEN to record the Linear comment-write cassette");
  }
  return token;
}

/** Same reasoning as `linearWrite.test.ts`'s `linearTeam`: a placeholder on replay, real when recording — the
 * cassette matcher collapses identifiers positionally, so both produce the same match key. */
function linearTeam(): string {
  if (!RECORD) {
    return "00000000-0000-4000-8000-000000000001";
  }
  const team = process.env["SLOPWEAVER_RECORD_LINEAR_TEAM"];
  if (team === undefined || team.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TEAM to the team UUID to create the test issues in");
  }
  return team;
}

/** The two throwaway issues. Every string is a LITERAL — no clock, no random — so the request matches. */
function issueInput({ nth }: { nth: 1 | 2 }): Readonly<Record<string, unknown>> {
  return {
    description: `Filed only to prove the comment and relation seams. Issue ${String(nth)} of two.`,
    teamId: linearTeam(),
    title: `[slopweaver integration test] comment/relation probe ${String(nth)} (auto-deleted)`,
  };
}

/**
 * A caller-chosen id for each throwaway issue. Fixed literals, so record and replay send the SAME outbound
 * variables and the cassette's positional-UUID match key agrees across both runs.
 *
 * **Re-recording needs new values here.** Linear moves a deleted issue to Recently Deleted for 30 days
 * rather than erasing it, so an id this test has already used stays occupied and `issueCreate` fails on it.
 * Measured, not assumed: the first recording of this cassette used `…00a1`/`…00a2`, and the second attempt
 * failed on the create. Bump the last group when you re-record. The same is true of every write cassette
 * here — `linearWrite.test.ts` derives its id from a fixed form, so it has the identical property.
 */
const ISSUE_IDS = ["00000000-0000-4000-8000-0000000000b3", "00000000-0000-4000-8000-0000000000b4"] as const;

const COMMENT_FORM: LinearCommentForm = {
  artifact: {
    detail: [{ kind: "para", text: "Posted at a caller-chosen id, so a lost response is settled by a read-back." }],
    evidence: [{ label: "the seam under test", url: "https://example.test/linear/comment-seam" }],
    summary: "The comment seam works: a capped lead, with the evidence folded beneath it.",
  },
  fields: { issueId: ISSUE_IDS[0] },
};

const RELATION_FORM: LinearRelationForm = {
  fields: { issueId: ISSUE_IDS[0], relatedIssueId: ISSUE_IDS[1], type: "blocks" },
};

describe("linear comment + relation write (integration — real Linear via Polly cassette)", () => {
  it("comments on a real issue and relates two, reads both back at the ids it chose, then deletes everything", async () => {
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      scheduler: (task) => task(),
      token: linearToken(),
    });

    const first = await api.createIssue({ id: ISSUE_IDS[0], input: issueInput({ nth: 1 }) });
    const second = await api.createIssue({ id: ISSUE_IDS[1], input: issueInput({ nth: 2 }) });
    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    const issueA = first._unsafeUnwrap();
    const issueB = second._unsafeUnwrap();

    // The comment body is rendered ONCE, by the same function the dry run prints, so the bytes proven here
    // are the bytes an operator was shown.
    const body = renderCommentBody({ artifact: COMMENT_FORM.artifact });
    expect(body.includes("+++ Detail and evidence")).toBe(true);
    const commentId = commentIntentId({ form: COMMENT_FORM });
    // The CALLER-CHOSEN id, not `issueA.id` from the response. They are the same issue — that is the whole
    // point of choosing the id — but only the literal is stable across record and replay: the response's id
    // is real when recording and synthetic on replay, and the cassette's match key is computed from the LIVE
    // request both times. A response-derived id in an outbound variable is therefore unmatchable.
    const posted = await api.createComment({ id: commentId, input: { body, issueId: ISSUE_IDS[0] } });
    expect(posted.isOk()).toBe(true);

    // THE comment assertion. It fails if the create silently did nothing, or if the id we chose is not the
    // id Linear stored. It survives redaction because both sides map through the same synthetic id.
    const readComment = await api.readComment({ id: commentId });
    expect(readComment.isOk()).toBe(true);
    const foundComment = readComment._unsafeUnwrap();
    expect(foundComment === undefined).toBe(false);
    expect(foundComment!.id).toBe(posted._unsafeUnwrap().id);
    expect(Number.isNaN(Date.parse(foundComment!.updatedAt))).toBe(false);

    const relationId = relationIntentId({ form: RELATION_FORM });
    const related = await api.createRelation({
      id: relationId,
      input: { issueId: ISSUE_IDS[0], relatedIssueId: ISSUE_IDS[1], type: "blocks" },
    });
    expect(related.isOk()).toBe(true);

    // THE relation assertion, and the reason this test files two issues: a `blocks` edge is DIRECTED, so
    // proving it means proving WHICH end is which. `type` is an allowlisted structural key, so it survives
    // redaction verbatim; the two ids survive as the same synthetic values the creates returned.
    const readRelation = await api.readRelation({ id: relationId });
    expect(readRelation.isOk()).toBe(true);
    const foundRelation = readRelation._unsafeUnwrap();
    expect(foundRelation === undefined).toBe(false);
    expect(foundRelation!.type).toBe("blocks");
    expect(foundRelation!.issueId).toBe(issueA.id);
    expect(foundRelation!.relatedIssueId).toBe(issueB.id);

    // Cleanup, asserted rather than fired and forgotten — in reverse dependency order, so nothing is deleted
    // out from under an edge that still points at it.
    const deletedRelation = await api.deleteRelation({ id: relationId });
    expect(deletedRelation.isOk()).toBe(true);
    expect(deletedRelation._unsafeUnwrap()).toBe(true);
    const deletedComment = await api.deleteComment({ id: commentId });
    expect(deletedComment.isOk()).toBe(true);
    expect(deletedComment._unsafeUnwrap()).toBe(true);
    for (const id of ISSUE_IDS) {
      const deleted = await api.deleteIssue({ id });
      expect(deleted.isOk()).toBe(true);
      expect(deleted._unsafeUnwrap()).toBe(true);
    }
  });
});
