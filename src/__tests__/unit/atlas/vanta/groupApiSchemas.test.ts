/**
 * The group write surface's wire contract: the ONE body serializer both the client and the preview send,
 * and the per-person result union that makes a failure without a message a parse failure rather than a
 * summary with an invented explanation.
 */
import { describe, expect, it } from "vitest";

import {
  VANTA_GROUP_MEMBERSHIP_BATCH_MAX,
  vantaGroupMembershipBody,
  vantaGroupMembershipResponseSchema,
  vantaGroupMembershipResultSchema,
} from "../../../../atlas/vanta/groupApiSchemas.js";

describe("VANTA_GROUP_MEMBERSHIP_BATCH_MAX", () => {
  it("is the maxItems both bulk request bodies declare", () => {
    expect(VANTA_GROUP_MEMBERSHIP_BATCH_MAX).toBe(100);
  });
});

describe("vantaGroupMembershipBody", () => {
  it("is compact, so the preview's bytes are the wire's bytes", () => {
    expect(vantaGroupMembershipBody({ updates: [{ id: "a" }, { id: "b" }] })).toBe(
      '{"updates":[{"id":"a"},{"id":"b"}]}',
    );
  });

  it("keeps the order it was given, because the approval digest is taken over it", () => {
    expect(vantaGroupMembershipBody({ updates: [{ id: "b" }, { id: "a" }] })).toBe(
      '{"updates":[{"id":"b"},{"id":"a"}]}',
    );
  });

  it("escapes a value that would otherwise break the document", () => {
    expect(vantaGroupMembershipBody({ updates: [{ id: 'a"b' }] })).toBe('{"updates":[{"id":"a\\"b"}]}');
  });
});

describe("vantaGroupMembershipResultSchema", () => {
  it("reads a success, which carries no message", () => {
    const parsed = vantaGroupMembershipResultSchema.safeParse({ id: "p1", status: "SUCCESS" });
    expect(parsed.success).toBe(true);
  });

  it("reads a failure, which carries one", () => {
    const parsed = vantaGroupMembershipResultSchema.safeParse({
      id: "p1",
      message: "person is not in that group",
      status: "ERROR",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a failure with no message rather than letting a reader invent one", () => {
    expect(vantaGroupMembershipResultSchema.safeParse({ id: "p1", status: "ERROR" }).success).toBe(false);
  });

  it("refuses a success that smuggles a message in, because the two arms are not the same shape", () => {
    expect(vantaGroupMembershipResultSchema.safeParse({ id: "p1", message: "fine", status: "SUCCESS" }).success).toBe(
      false,
    );
  });

  it("refuses a status Vanta does not document, so an unknown one never counts as a success", () => {
    expect(vantaGroupMembershipResultSchema.safeParse({ id: "p1", status: "PENDING" }).success).toBe(false);
  });
});

describe("vantaGroupMembershipResponseSchema", () => {
  it("reads a mixed batch", () => {
    const parsed = vantaGroupMembershipResponseSchema.safeParse({
      results: [
        { id: "p1", status: "SUCCESS" },
        { id: "p2", message: "no such person", status: "ERROR" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an envelope carrying a field this package does not know", () => {
    expect(vantaGroupMembershipResponseSchema.safeParse({ nextCursor: null, results: [] }).success).toBe(false);
  });
});
