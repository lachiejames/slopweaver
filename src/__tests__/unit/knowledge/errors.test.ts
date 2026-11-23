/**
 * The knowledge domain's error factories — the only place one of its failures is built.
 *
 * Each case asserts the MESSAGE a caller displays, not just the code, because the message is what a session
 * acts on: `.claude/rules/error-handling.md` says a consumer displays `message` and branches on `code`, so a
 * factory whose message stopped naming the thing that failed would be invisible to a code-only assertion.
 */
import { describe, expect, it } from "vitest";

import { KnowledgeErrors } from "../../../knowledge/errors.js";

describe("KnowledgeErrors", () => {
  it("names the claim id a recall could not find, and what to do instead", () => {
    const error = KnowledgeErrors.memoryUnknown({ memoryId: "t-abc" });
    expect(error.code).toBe("MEMORY_UNKNOWN");
    expect(error.memoryId).toBe("t-abc");
    expect(error.message).toContain("no recording carries the claim id t-abc");
  });

  it("names the field and why, so a writer is told what to fix", () => {
    expect(KnowledgeErrors.invalidField({ field: "outcome", why: "must be paid or empty" }).message).toBe(
      "outcome must be paid or empty",
    );
  });

  it("names the domain that is not a slug", () => {
    const error = KnowledgeErrors.invalidDomain({ domain: "Data Dog!" });
    expect(error.code).toBe("INVALID_DOMAIN");
    expect(error.domain).toBe("Data Dog!");
  });

  it("carries the line number of a corrupt row, so the file can be inspected by hand", () => {
    const error = KnowledgeErrors.corruptRow({ lineNumber: 42 });
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.lineNumber).toBe(42);
  });

  it("names the recording a stored row cannot be explained by, and why", () => {
    const error = KnowledgeErrors.corruptRecording({ recordingId: "r-1", why: "a lesson facet is null" });
    expect(error.recordingId).toBe("r-1");
    expect(error.message).toContain("a lesson facet is null");
  });

  it("names the real destination when a placement is refused, rather than the flag that was wrong", () => {
    const error = KnowledgeErrors.placementRefused({ destination: "a board row", placement: "board" });
    expect(error.code).toBe("PLACEMENT_REFUSED");
    expect(error.message).toContain("a board row");
  });

  it("carries the driver's own message on a database failure, with what was being done", () => {
    const error = KnowledgeErrors.databaseFailed({ cause: new Error("connection refused"), doing: "record a memory" });
    expect(error.code).toBe("DATABASE_FAILED");
    expect(error.message).toContain("record a memory");
    expect(error.message).toContain("connection refused");
  });

  it("says so plainly when the driver carried no message at all", () => {
    expect(KnowledgeErrors.databaseFailed({ cause: {}, doing: "read the register" }).message).toContain(
      "the store refused, and carried no message",
    );
  });

  it("takes a plain string cause as the message it is", () => {
    expect(KnowledgeErrors.databaseFailed({ cause: "insert returned no row", doing: "record" }).message).toContain(
      "insert returned no row",
    );
  });

  it("names the import key a second apply would collide on", () => {
    const error = KnowledgeErrors.importConflict({ importKey: "abc:0000000001" });
    expect(error.code).toBe("IMPORT_CONFLICT");
    expect(error.importKey).toBe("abc:0000000001");
  });

  it("names the path a register could not be read from, never an empty register", () => {
    const error = KnowledgeErrors.storeUnreadable({ cause: new Error("EACCES"), path: "/home/knowledge.jsonl" });
    expect(error.code).toBe("STORE_UNREADABLE");
    expect(error.path).toBe("/home/knowledge.jsonl");
  });
});
