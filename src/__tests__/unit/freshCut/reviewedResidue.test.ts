/**
 * The reviewed-residue list's pure half: a line's exact-byte digest, the multiset subtraction verify applies, and
 * the candidate check `fresh-cut accept` applies before it appends anything.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CutFile, FreshCutFinding } from "../../../freshCut/core.js";
import {
  acceptanceCandidate,
  lineBytesAt,
  type ReviewedResidueEntry,
  reviewedLineSha256,
  reviewedResidueEntrySchema,
  subtractReviewedResidue,
} from "../../../freshCut/reviewedResidue.js";
import { unwrap } from "../../../lib/result.js";

/** The digest of a string's UTF-8 bytes. */
const sha = ({ text }: { text: string }): string =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const FILE: CutFile = { bytes: Buffer.from("alpha\nmask line\r\nmask line\r\ngamma", "utf8"), path: "src/a.ts" };

/** One owner-address finding at a line of {@link FILE}. */
const address = ({ line }: { line: number }): FreshCutFinding => ({
  className: "owner-address",
  kind: "private-term",
  line,
  path: "src/a.ts",
});

/** One entry keyed on a digest, with every other field fixed. */
const entry = (over: Partial<ReviewedResidueEntry> = {}): ReviewedResidueEntry => ({
  className: "owner-address",
  entryId: "0b7e5e4c-6a8a-4d3e-9b1d-2f4a6c8e0a1b",
  judgement: "not-an-address",
  lineNumberAtReview: 2,
  lineSha256: sha({ text: "mask line\r" }),
  path: "src/a.ts",
  reviewedAtIso: "2026-11-20T01:02:03.000Z",
  reviewedBySessionId: "session-1",
  reviewedRecordId: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  reviewedTreeSha: "a".repeat(40),
  schemaVersion: 1,
  ...over,
});

describe("lineBytesAt", () => {
  it("returns a line's exact bytes, a CR kept and the LF dropped", () => {
    expect(unwrap(lineBytesAt({ bytes: FILE.bytes, line: 2 })).toString("utf8")).toBe("mask line\r");
  });

  it("returns the last line when the file has no trailing newline", () => {
    expect(unwrap(lineBytesAt({ bytes: FILE.bytes, line: 4 })).toString("utf8")).toBe("gamma");
  });

  it("treats a NUL as a line break, as the verify's scan does", () => {
    expect(unwrap(lineBytesAt({ bytes: Buffer.from("one\u0000two", "utf8"), line: 2 })).toString("utf8")).toBe("two");
  });

  it("refuses a line past the last", () => {
    const result = lineBytesAt({ bytes: FILE.bytes, line: 5 });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("LINE_OUT_OF_RANGE");
  });
});

describe("reviewedLineSha256", () => {
  it("hashes the line's bytes, not its trimmed text", () => {
    expect(unwrap(reviewedLineSha256({ bytes: FILE.bytes, line: 2 }))).toBe(sha({ text: "mask line\r" }));
  });
});

describe("reviewedResidueEntrySchema", () => {
  it("accepts an owner-address entry", () => {
    expect(reviewedResidueEntrySchema.safeParse(entry()).success).toBe(true);
  });

  it("refuses any other class, so a hand-written entry cannot hide a finding the owner has not ruled on", () => {
    expect(reviewedResidueEntrySchema.safeParse({ ...entry(), className: "topic" }).success).toBe(false);
  });

  it("refuses a field the schema does not declare, such as matched text", () => {
    expect(reviewedResidueEntrySchema.safeParse({ ...entry(), matched: "x" }).success).toBe(false);
  });
});

describe("subtractReviewedResidue", () => {
  it("takes out a finding whose path, class and line digest match an entry, and counts it", () => {
    const result = subtractReviewedResidue({
      entries: [entry()],
      files: [FILE],
      findings: [address({ line: 2 }), address({ line: 1 })],
    });
    expect(result).toEqual({ findings: [address({ line: 1 })], reviewedAccepted: 1 });
  });

  it("takes out ONE finding per entry, so two identical lines need two entries", () => {
    const result = subtractReviewedResidue({
      entries: [entry()],
      files: [FILE],
      findings: [address({ line: 2 }), address({ line: 3 })],
    });
    expect(result).toEqual({ findings: [address({ line: 3 })], reviewedAccepted: 1 });
  });

  it("takes out both identical lines when two entries name them", () => {
    const second = entry({ entryId: "1c8f6f5d-7b9b-4e4f-8c2e-3a5b7d9f1b2c", lineNumberAtReview: 3 });
    const result = subtractReviewedResidue({
      entries: [entry(), second],
      files: [FILE],
      findings: [address({ line: 2 }), address({ line: 3 })],
    });
    expect(result).toEqual({ findings: [], reviewedAccepted: 2 });
  });

  it("refuses again when the line's bytes changed", () => {
    const changed: CutFile = { bytes: Buffer.from("alpha\nmask line two\r\n", "utf8"), path: "src/a.ts" };
    const result = subtractReviewedResidue({ entries: [entry()], files: [changed], findings: [address({ line: 2 })] });
    expect(result).toEqual({ findings: [address({ line: 2 })], reviewedAccepted: 0 });
  });

  it("never takes out another class at the same line", () => {
    const topic: FreshCutFinding = { className: "topic", kind: "private-term", line: 2, path: "src/a.ts" };
    const result = subtractReviewedResidue({ entries: [entry()], files: [FILE], findings: [topic] });
    expect(result).toEqual({ findings: [topic], reviewedAccepted: 0 });
  });

  it("never takes out a hygiene finding or a path-list finding", () => {
    const hygiene: FreshCutFinding = { kind: "hygiene", label: "denylist", line: 2, path: "src/a.ts" };
    const pathList: FreshCutFinding = {
      className: "owner-address",
      kind: "private-term",
      line: 2,
      path: "(file paths)",
    };
    const result = subtractReviewedResidue({ entries: [entry()], files: [FILE], findings: [hygiene, pathList] });
    expect(result).toEqual({ findings: [hygiene, pathList], reviewedAccepted: 0 });
  });

  it("never takes out a path-list finding, even when a real file carries the path list's own name", () => {
    const named: CutFile = { bytes: Buffer.from("alpha\nmask line\r\n", "utf8"), path: "(file paths)" };
    const pathList: FreshCutFinding = {
      className: "owner-address",
      kind: "private-term",
      line: 2,
      path: "(file paths)",
    };
    const withheld: FreshCutFinding = { ...pathList, path: "(file paths) line 2" };
    const result = subtractReviewedResidue({
      entries: [entry({ path: "(file paths)" }), entry({ path: "(file paths) line 2" })],
      files: [named, { ...named, path: "(file paths) line 2" }],
      findings: [pathList, withheld],
    });
    expect(result).toEqual({ findings: [pathList, withheld], reviewedAccepted: 0 });
  });

  it("takes out nothing from an empty list", () => {
    expect(subtractReviewedResidue({ entries: [], files: [FILE], findings: [address({ line: 2 })] })).toEqual({
      findings: [address({ line: 2 })],
      reviewedAccepted: 0,
    });
  });
});

describe("acceptanceCandidate", () => {
  it("returns the line's digest for an open owner-address finding", () => {
    const result = acceptanceCandidate({
      entries: [],
      files: [FILE],
      findings: [address({ line: 2 })],
      line: 2,
      path: "src/a.ts",
    });
    expect(unwrap(result)).toBe(sha({ text: "mask line\r" }));
  });

  it("refuses a line already accepted", () => {
    const result = acceptanceCandidate({
      entries: [entry()],
      files: [FILE],
      findings: [address({ line: 2 })],
      line: 2,
      path: "src/a.ts",
    });
    expect(result._unsafeUnwrapErr().code).toBe("NO_SUCH_FINDING");
  });

  it("still accepts the second of two identical lines when one is accepted", () => {
    const result = acceptanceCandidate({
      entries: [entry()],
      files: [FILE],
      findings: [address({ line: 2 }), address({ line: 3 })],
      line: 3,
      path: "src/a.ts",
    });
    expect(unwrap(result)).toBe(sha({ text: "mask line\r" }));
  });

  it("refuses a line the scan did not flag", () => {
    const result = acceptanceCandidate({
      entries: [],
      files: [FILE],
      findings: [address({ line: 2 })],
      line: 1,
      path: "src/a.ts",
    });
    expect(result._unsafeUnwrapErr().code).toBe("NO_SUCH_FINDING");
  });

  it("refuses a finding of another class at that line", () => {
    const topic: FreshCutFinding = { className: "topic", kind: "private-term", line: 2, path: "src/a.ts" };
    const result = acceptanceCandidate({ entries: [], files: [FILE], findings: [topic], line: 2, path: "src/a.ts" });
    expect(result._unsafeUnwrapErr().code).toBe("NO_SUCH_FINDING");
  });

  it("refuses a path that is not a file of the cut, such as the path list", () => {
    const result = acceptanceCandidate({
      entries: [],
      files: [FILE],
      findings: [address({ line: 2 })],
      line: 2,
      path: "(file paths)",
    });
    expect(result._unsafeUnwrapErr().code).toBe("NOT_A_FILE");
  });

  it("refuses the path list's locus even when a real file carries that name and the line is flagged", () => {
    const named: CutFile = { bytes: Buffer.from("alpha\nmask line\r\n", "utf8"), path: "(file paths)" };
    const flagged: FreshCutFinding = {
      className: "owner-address",
      kind: "private-term",
      line: 2,
      path: "(file paths)",
    };
    const result = acceptanceCandidate({
      entries: [],
      files: [named],
      findings: [flagged],
      line: 2,
      path: "(file paths)",
    });
    expect(result._unsafeUnwrapErr().message).toBe(
      "that path is the path list's locus, which nothing is accepted from",
    );
  });
});
