/**
 * The reviewed-residue list's pure half: a line's exact-byte digest, the two entry shapes, the multiset subtraction
 * verify applies (an anchored entry only in its own record and tree), and the candidate check `fresh-cut accept`
 * applies before it appends anything. Every term and anchor here is synthetic.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { emptyAcceptedOnAnchor } from "../../../freshCut/anchoredAcceptance.js";
import type { CutFile, FreshCutFinding } from "../../../freshCut/core.js";
import {
  acceptanceCandidate,
  isCanonicalTurnPointer,
  lineBytesAt,
  type OwnerAddressResidueEntry,
  type OwnerAnchoredResidueEntry,
  reviewedLineSha256,
  reviewedResidueEntrySchema,
  subtractReviewedResidue,
} from "../../../freshCut/reviewedResidue.js";
import { unwrap } from "../../../lib/result.js";

/** The digest of a string's UTF-8 bytes. */
const sha = ({ text }: { text: string }): string =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const FILE: CutFile = { bytes: Buffer.from("alpha\nmask line\r\nmask line\r\ngamma", "utf8"), path: "src/a.ts" };

/** The record and tree every call below verifies, unless a case names another. */
const RECORD = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const TREE = "a".repeat(40);
const SCOPE = { recordId: RECORD, treeSha: TREE };

/** A synthetic owner anchor: two made-up UUIDs, naming no real transcript. */
const ANCHOR = "transcript:11111111-0000-4333-8444-555555555555#66666666-0000-4888-9999-aaaaaaaaaaaa";

/** One owner-address finding at a line of {@link FILE}. */
const address = ({ line }: { line: number }): FreshCutFinding => ({
  className: "owner-address",
  kind: "private-term",
  line,
  path: "src/a.ts",
});

/** One topic finding at a line of {@link FILE}. */
const topic = ({ line }: { line: number }): FreshCutFinding => ({
  className: "topic",
  kind: "private-term",
  line,
  path: "src/a.ts",
});

/** One owner-address entry keyed on a digest, with every other field fixed. */
const entry = (over: Partial<OwnerAddressResidueEntry> = {}): OwnerAddressResidueEntry => ({
  className: "owner-address",
  entryId: "0b7e5e4c-6a8a-4d3e-9b1d-2f4a6c8e0a1b",
  judgement: "not-an-address",
  lineNumberAtReview: 2,
  lineSha256: sha({ text: "mask line\r" }),
  path: "src/a.ts",
  reviewedAtIso: "2026-11-20T01:02:03.000Z",
  reviewedBySessionId: "session-1",
  reviewedRecordId: RECORD,
  reviewedTreeSha: TREE,
  schemaVersion: 1,
  ...over,
});

/** One topic entry accepted on {@link ANCHOR} in {@link RECORD}, with every other field fixed. */
const anchored = (over: Partial<OwnerAnchoredResidueEntry> = {}): OwnerAnchoredResidueEntry => ({
  className: "topic",
  entryId: "2d9a7a6e-8c0c-4f5a-9d3f-4b6c8e0a2c3d",
  lineNumberAtReview: 2,
  lineSha256: sha({ text: "mask line\r" }),
  ownerAnchor: ANCHOR,
  path: "src/a.ts",
  reviewedAtIso: "2026-11-20T01:02:03.000Z",
  reviewedBySessionId: "session-1",
  reviewedRecordId: RECORD,
  reviewedTreeSha: TREE,
  schemaVersion: 2,
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

describe("isCanonicalTurnPointer", () => {
  it("accepts a pointer exactly as the formatter writes it", () => {
    expect(isCanonicalTurnPointer({ value: ANCHOR })).toBe(true);
  });

  it("refuses a padded pointer, an upper-case one and a bare scheme", () => {
    expect(
      [` ${ANCHOR}`, ANCHOR.toUpperCase().replace("TRANSCRIPT:", "transcript:"), "transcript:"].map((value) =>
        isCanonicalTurnPointer({ value }),
      ),
    ).toEqual([false, false, false]);
  });
});

describe("reviewedResidueEntrySchema", () => {
  it("accepts an owner-address entry, unchanged from before the anchored shape", () => {
    expect(reviewedResidueEntrySchema.safeParse(entry()).success).toBe(true);
  });

  it("refuses a version 1 entry of any other class, so a reader's judgement never accepts a word the owner rules on", () => {
    expect(reviewedResidueEntrySchema.safeParse({ ...entry(), className: "topic" }).success).toBe(false);
  });

  it("refuses a version 1 entry carrying an anchor", () => {
    expect(reviewedResidueEntrySchema.safeParse({ ...entry(), ownerAnchor: ANCHOR }).success).toBe(false);
  });

  it("accepts an anchored entry of a non-owner-address class", () => {
    expect(reviewedResidueEntrySchema.safeParse(anchored()).success).toBe(true);
  });

  it("refuses an anchored entry of owner-address, with no anchor, a malformed anchor, or a judgement", () => {
    const { ownerAnchor: _dropped, ...unanchored } = anchored();
    expect(
      [
        { ...anchored(), className: "owner-address" },
        unanchored,
        { ...anchored(), ownerAnchor: "the owner said so" },
        { ...anchored(), judgement: "placeholder" },
      ].map((candidate) => reviewedResidueEntrySchema.safeParse(candidate).success),
    ).toEqual([false, false, false, false]);
  });

  it("refuses a field the schema does not declare, such as matched text or the line's text", () => {
    expect(
      [
        { ...entry(), matched: "x" },
        { ...anchored(), matched: "x" },
        { ...anchored(), lineText: "x" },
      ].map((candidate) => reviewedResidueEntrySchema.safeParse(candidate).success),
    ).toEqual([false, false, false]);
  });
});

describe("subtractReviewedResidue", () => {
  it("takes out a finding whose path, class and line digest match an entry, and counts it", () => {
    const result = subtractReviewedResidue({
      ...SCOPE,
      entries: [entry()],
      files: [FILE],
      findings: [address({ line: 2 }), address({ line: 1 })],
    });
    expect(result).toEqual({
      acceptedOnAnchor: emptyAcceptedOnAnchor(),
      findings: [address({ line: 1 })],
      reviewedAccepted: 1,
    });
  });

  it("takes out ONE finding per entry, so two identical lines need two entries", () => {
    const result = subtractReviewedResidue({
      ...SCOPE,
      entries: [entry()],
      files: [FILE],
      findings: [address({ line: 2 }), address({ line: 3 })],
    });
    expect(result).toEqual({
      acceptedOnAnchor: emptyAcceptedOnAnchor(),
      findings: [address({ line: 3 })],
      reviewedAccepted: 1,
    });
  });

  it("takes out both identical lines when two entries name them", () => {
    const second = entry({ entryId: "1c8f6f5d-7b9b-4e4f-8c2e-3a5b7d9f1b2c", lineNumberAtReview: 3 });
    const result = subtractReviewedResidue({
      ...SCOPE,
      entries: [entry(), second],
      files: [FILE],
      findings: [address({ line: 2 }), address({ line: 3 })],
    });
    expect(result).toEqual({ acceptedOnAnchor: emptyAcceptedOnAnchor(), findings: [], reviewedAccepted: 2 });
  });

  it("refuses again when the line's bytes changed", () => {
    const changed: CutFile = { bytes: Buffer.from("alpha\nmask line two\r\n", "utf8"), path: "src/a.ts" };
    const result = subtractReviewedResidue({
      ...SCOPE,
      entries: [entry(), anchored()],
      files: [changed],
      findings: [address({ line: 2 }), topic({ line: 2 })],
    });
    expect(result).toEqual({
      acceptedOnAnchor: emptyAcceptedOnAnchor(),
      findings: [address({ line: 2 }), topic({ line: 2 })],
      reviewedAccepted: 0,
    });
  });

  it("never takes out another class at the same line", () => {
    const result = subtractReviewedResidue({
      ...SCOPE,
      entries: [entry()],
      files: [FILE],
      findings: [topic({ line: 2 })],
    });
    expect(result).toEqual({
      acceptedOnAnchor: emptyAcceptedOnAnchor(),
      findings: [topic({ line: 2 })],
      reviewedAccepted: 0,
    });
  });

  it("never takes out a hygiene finding or a path-list finding", () => {
    const hygiene: FreshCutFinding = { kind: "hygiene", label: "denylist", line: 2, path: "src/a.ts" };
    const pathList: FreshCutFinding = {
      className: "owner-address",
      kind: "private-term",
      line: 2,
      path: "(file paths)",
    };
    const result = subtractReviewedResidue({
      ...SCOPE,
      entries: [entry()],
      files: [FILE],
      findings: [hygiene, pathList],
    });
    expect(result).toEqual({
      acceptedOnAnchor: emptyAcceptedOnAnchor(),
      findings: [hygiene, pathList],
      reviewedAccepted: 0,
    });
  });

  it("never takes out a path-list finding, even when a real file carries the path list's own name", () => {
    const named: CutFile = { bytes: Buffer.from("alpha\nmask line\r\n", "utf8"), path: "(file paths)" };
    const pathList: FreshCutFinding = { className: "topic", kind: "private-term", line: 2, path: "(file paths)" };
    const withheld: FreshCutFinding = { ...pathList, path: "(file paths) line 2" };
    const result = subtractReviewedResidue({
      ...SCOPE,
      entries: [anchored({ path: "(file paths)" }), anchored({ path: "(file paths) line 2" })],
      files: [named, { ...named, path: "(file paths) line 2" }],
      findings: [pathList, withheld],
    });
    expect(result).toEqual({
      acceptedOnAnchor: emptyAcceptedOnAnchor(),
      findings: [pathList, withheld],
      reviewedAccepted: 0,
    });
  });

  it("takes out nothing from an empty list", () => {
    expect(subtractReviewedResidue({ ...SCOPE, entries: [], files: [FILE], findings: [address({ line: 2 })] })).toEqual(
      { acceptedOnAnchor: emptyAcceptedOnAnchor(), findings: [address({ line: 2 })], reviewedAccepted: 0 },
    );
  });

  it("takes out an anchored finding in its own record and tree, and counts it under its class", () => {
    const result = subtractReviewedResidue({
      ...SCOPE,
      entries: [anchored(), entry()],
      files: [FILE],
      findings: [topic({ line: 2 }), address({ line: 3 })],
    });
    expect(result).toEqual({
      acceptedOnAnchor: { ...emptyAcceptedOnAnchor(), topic: 1 },
      findings: [],
      reviewedAccepted: 2,
    });
  });

  it("counts each anchored class apart, and leaves the findings no entry covers in report order", () => {
    const name = ({ line }: { line: number }): FreshCutFinding => ({
      className: "owner-name",
      kind: "private-term",
      line,
      path: "src/a.ts",
    });
    const second = "4e1b9c8d-0a2b-4c3d-8e4f-5a6b7c8d9e0f";
    const third = "5f2c0d9e-1b3c-4d4e-9f5a-6b7c8d9e0f1a";
    const result = subtractReviewedResidue({
      ...SCOPE,
      entries: [
        anchored(),
        anchored({ entryId: second, lineNumberAtReview: 3 }),
        anchored({ className: "owner-name", entryId: third }),
      ],
      files: [FILE],
      findings: [name({ line: 1 }), topic({ line: 2 }), name({ line: 2 }), topic({ line: 3 }), name({ line: 3 })],
    });
    expect(result).toEqual({
      acceptedOnAnchor: { ...emptyAcceptedOnAnchor(), "owner-name": 1, topic: 2 },
      findings: [name({ line: 1 }), name({ line: 3 })],
      reviewedAccepted: 3,
    });
  });

  it("never takes out an anchored finding in another record, or in its record over another tree", () => {
    const elsewhere = [
      { recordId: "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d", treeSha: TREE },
      { recordId: RECORD, treeSha: "b".repeat(40) },
    ].map((scope) =>
      subtractReviewedResidue({ ...scope, entries: [anchored()], files: [FILE], findings: [topic({ line: 2 })] }),
    );
    expect(elsewhere).toEqual([
      { acceptedOnAnchor: emptyAcceptedOnAnchor(), findings: [topic({ line: 2 })], reviewedAccepted: 0 },
      { acceptedOnAnchor: emptyAcceptedOnAnchor(), findings: [topic({ line: 2 })], reviewedAccepted: 0 },
    ]);
  });

  it("still takes out an owner-address finding in another record, as it always has", () => {
    const result = subtractReviewedResidue({
      entries: [entry()],
      files: [FILE],
      findings: [address({ line: 2 })],
      recordId: "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d",
      treeSha: "b".repeat(40),
    });
    expect(result).toEqual({ acceptedOnAnchor: emptyAcceptedOnAnchor(), findings: [], reviewedAccepted: 1 });
  });
});

describe("acceptanceCandidate", () => {
  it("returns the line's digest for an open owner-address finding", () => {
    const result = acceptanceCandidate({
      ...SCOPE,
      className: "owner-address",
      entries: [],
      files: [FILE],
      findings: [address({ line: 2 })],
      line: 2,
      path: "src/a.ts",
    });
    expect(unwrap(result)).toBe(sha({ text: "mask line\r" }));
  });

  it("returns the line's digest for an open finding of the named anchored class", () => {
    const result = acceptanceCandidate({
      ...SCOPE,
      className: "topic",
      entries: [],
      files: [FILE],
      findings: [address({ line: 2 }), topic({ line: 2 })],
      line: 2,
      path: "src/a.ts",
    });
    expect(unwrap(result)).toBe(sha({ text: "mask line\r" }));
  });

  it("refuses a line already accepted", () => {
    const result = acceptanceCandidate({
      ...SCOPE,
      className: "owner-address",
      entries: [entry()],
      files: [FILE],
      findings: [address({ line: 2 })],
      line: 2,
      path: "src/a.ts",
    });
    expect(result._unsafeUnwrapErr().message).toBe(
      "that line holds no owner-address finding the list does not already accept",
    );
  });

  it("refuses an anchored line already accepted in this record, and allows it in another", () => {
    const here = acceptanceCandidate({
      ...SCOPE,
      className: "topic",
      entries: [anchored()],
      files: [FILE],
      findings: [topic({ line: 2 })],
      line: 2,
      path: "src/a.ts",
    });
    const there = acceptanceCandidate({
      className: "topic",
      entries: [anchored()],
      files: [FILE],
      findings: [topic({ line: 2 })],
      line: 2,
      path: "src/a.ts",
      recordId: "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d",
      treeSha: TREE,
    });
    expect(here._unsafeUnwrapErr().code).toBe("NO_SUCH_FINDING");
    expect(unwrap(there)).toBe(sha({ text: "mask line\r" }));
  });

  it("still accepts the second of two identical lines when one is accepted", () => {
    const result = acceptanceCandidate({
      ...SCOPE,
      className: "owner-address",
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
      ...SCOPE,
      className: "owner-address",
      entries: [],
      files: [FILE],
      findings: [address({ line: 2 })],
      line: 1,
      path: "src/a.ts",
    });
    expect(result._unsafeUnwrapErr().code).toBe("NO_SUCH_FINDING");
  });

  it("refuses a finding of another class than the one named at that line", () => {
    const results = [
      { className: "owner-address" as const, finding: topic({ line: 2 }) },
      { className: "money" as const, finding: topic({ line: 2 }) },
    ].map(({ className, finding }) =>
      acceptanceCandidate({
        ...SCOPE,
        className,
        entries: [],
        files: [FILE],
        findings: [finding],
        line: 2,
        path: "src/a.ts",
      }),
    );
    expect(results.map((result) => result._unsafeUnwrapErr().code)).toEqual(["NO_SUCH_FINDING", "NO_SUCH_FINDING"]);
  });

  it("refuses a path that is not a file of the cut, such as the path list", () => {
    const result = acceptanceCandidate({
      ...SCOPE,
      className: "owner-address",
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
    const flagged: FreshCutFinding = { className: "topic", kind: "private-term", line: 2, path: "(file paths)" };
    const result = acceptanceCandidate({
      ...SCOPE,
      className: "topic",
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
