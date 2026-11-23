/*
 * The CREATE-ONLY slices of the Linear write API, called directly over one send context: a project update, a
 * comment and a relation each send the caller-chosen id inside the input and read the object back through its
 * own shaper.
 *
 * The transport is a plain injected function that records its calls. That is a seam, not a mock.
 */
import { describe, expect, it } from "vitest";

import { makeLinearSendContext } from "../../../../corpus/linear/write.js";
import { commentApi, projectUpdateApi } from "../../../../corpus/linear/writeCreateOnly.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../../../linearWritePrivacyFixture.js";

/** A send context whose transport returns a fixed payload and records every request it was handed. */
function contextWith({ reply }: { reply: unknown }) {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const ctx = makeLinearSendContext({
    privacy: NO_TERMS_LINEAR_PRIVACY,
    request: ({ query, variables }) => {
      calls.push({ query, variables });
      return Promise.resolve(reply);
    },
    scheduler: (task) => task(),
    token: "lin_api_fake",
  });
  return { calls, ctx };
}

describe("projectUpdateApi", () => {
  it("posts at the CALLER-CHOSEN id, sent inside the input", async () => {
    const { calls, ctx } = contextWith({
      reply: { projectUpdateCreate: { projectUpdate: { id: "pu-1" }, success: true } },
    });
    const result = await projectUpdateApi({ ctx }).createProjectUpdate({
      id: "pu-1",
      input: { body: "x", projectId: "p1" },
    });

    expect(result._unsafeUnwrap()).toEqual({ id: "pu-1" });
    expect(calls.length).toBe(1);
    expect(calls[0]!.variables["input"]).toEqual({ body: "x", id: "pu-1", projectId: "p1" });
  });

  it("shapes a read-back and keeps an absent body as undefined", async () => {
    const node = { health: "onTrack", id: "pu-1", updatedAt: "2026-08-01T00:00:00Z", url: "https://linear.test/pu" };
    const { ctx } = contextWith({ reply: { projectUpdate: node } });
    const result = await projectUpdateApi({ ctx }).readProjectUpdate({ id: "pu-1" });

    expect(result._unsafeUnwrap()).toEqual({ ...node, body: undefined });
  });
});

describe("commentApi", () => {
  it("posts a comment at the CALLER-CHOSEN id, sent inside the input", async () => {
    const { calls, ctx } = contextWith({ reply: { commentCreate: { comment: { id: "c-1" }, success: true } } });
    const result = await commentApi({ ctx }).createComment({ id: "c-1", input: { body: "hi", issueId: "i1" } });

    expect(result._unsafeUnwrap()).toEqual({ id: "c-1" });
    expect(calls[0]!.variables["input"]).toEqual({ body: "hi", id: "c-1", issueId: "i1" });
  });

  it("answers undefined rather than an error when the comment does not exist", async () => {
    const { ctx } = contextWith({ reply: { comment: null } });
    const result = await commentApi({ ctx }).readComment({ id: "c-missing" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(undefined);
  });

  it("reads a relation back with the pair it joined", async () => {
    const node = { id: "r-1", issue: { id: "i1" }, relatedIssue: { id: "i2" }, type: "blocks" };
    const { ctx } = contextWith({ reply: { issueRelation: node } });
    const result = await commentApi({ ctx }).readRelation({ id: "r-1" });

    expect(result._unsafeUnwrap()).toEqual({ id: "r-1", issueId: "i1", relatedIssueId: "i2", type: "blocks" });
  });
});
