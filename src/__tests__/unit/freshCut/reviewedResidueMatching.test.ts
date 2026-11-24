/**
 * Which finding each reviewed-residue entry takes out: an entry clears only the one line it was accepted for, never a
 * byte-identical copy met first; an owner-address entry follows its occurrence across cuts; an older one with no
 * occurrence fails closed on a duplicate outside its own cut; and an applicable entry that takes nothing is counted.
 * Every line, term and address here is synthetic, and an address sits under `example.invalid`.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CutFile, FreshCutFinding } from "../../../freshCut/core.js";
import { lineNumbersByDigest, reviewedLineIdentity } from "../../../freshCut/reviewedLines.js";
import {
  type OwnerAddressResidueEntry,
  type OwnerAnchoredResidueEntry,
  reviewedResidueEntrySchema,
} from "../../../freshCut/reviewedResidue.js";
import { isPathListLocus, matchReviewedResidue } from "../../../freshCut/reviewedResidueMatching.js";
import type { PrivateTermClass } from "../../../hygiene/privateTerms.js";
import { unwrap } from "../../../lib/result.js";

/** The digest of a string's UTF-8 bytes. */
const sha = ({ text }: { text: string }): string =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const LINE = "mail ops@example.invalid";

/** A file of the cut holding `lines`, joined by LF. */
const fileOf = ({ lines }: { lines: readonly string[] }): CutFile => ({
  bytes: Buffer.from(lines.join("\n"), "utf8"),
  path: "src/a.ts",
});

/** Two identical lines at 2 and 4, with other lines around them. */
const TWICE = fileOf({ lines: ["alpha", LINE, "beta", LINE, "gamma"] });

const RECORD = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const TREE = "a".repeat(40);
const SCOPE = { recordId: RECORD, treeSha: TREE };
const ELSEWHERE = { recordId: "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d", treeSha: "b".repeat(40) };

/** One private-term finding of a class at a line of `src/a.ts`. */
const finding = ({ className, line }: { className: PrivateTermClass; line: number }): FreshCutFinding => ({
  className,
  kind: "private-term",
  line,
  path: "src/a.ts",
});

/** One owner-address entry for {@link LINE}, accepted in {@link RECORD}. */
const address = (over: Partial<OwnerAddressResidueEntry> = {}): OwnerAddressResidueEntry => ({
  className: "owner-address",
  entryId: "0b7e5e4c-6a8a-4d3e-9b1d-2f4a6c8e0a1b",
  judgement: "placeholder",
  lineNumberAtReview: 4,
  lineSha256: sha({ text: LINE }),
  path: "src/a.ts",
  reviewedAtIso: "2026-11-20T01:02:03.000Z",
  reviewedBySessionId: "session-1",
  reviewedRecordId: RECORD,
  reviewedTreeSha: TREE,
  schemaVersion: 1,
  ...over,
});

/** One topic entry for {@link LINE}, accepted on a synthetic anchor in {@link RECORD}. */
const anchored = (over: Partial<OwnerAnchoredResidueEntry> = {}): OwnerAnchoredResidueEntry => ({
  className: "topic",
  entryId: "2d9a7a6e-8c0c-4f5a-9d3f-4b6c8e0a2c3d",
  lineNumberAtReview: 4,
  lineSha256: sha({ text: LINE }),
  ownerAnchor: "transcript:11111111-0000-4333-8444-555555555555#66666666-0000-4888-9999-aaaaaaaaaaaa",
  path: "src/a.ts",
  reviewedAtIso: "2026-11-20T01:02:03.000Z",
  reviewedBySessionId: "session-1",
  reviewedRecordId: RECORD,
  reviewedTreeSha: TREE,
  schemaVersion: 2,
  ...over,
});

/** The matched finding indexes, sorted, and the unmatched count, of one match. */
const matchOf = (options: Parameters<typeof matchReviewedResidue>[0]): readonly [readonly number[], number] => {
  const { matched, unmatched } = matchReviewedResidue(options);
  return [[...matched].toSorted((a, b) => a - b), unmatched];
};

describe("reviewedLineIdentity", () => {
  it("numbers each identical line's occurrence in file order", () => {
    expect([2, 4].map((line) => unwrap(reviewedLineIdentity({ bytes: TWICE.bytes, line })))).toEqual([
      { lineSha256: sha({ text: LINE }), occurrence: 1 },
      { lineSha256: sha({ text: LINE }), occurrence: 2 },
    ]);
  });

  it("splits at a NUL as at an LF, and keeps a CR as part of its line", () => {
    const bytes = Buffer.from(`${LINE}\r\n${LINE}\u0000${LINE}\r`, "utf8");
    expect([1, 2, 3].map((line) => unwrap(reviewedLineIdentity({ bytes, line })))).toEqual([
      { lineSha256: sha({ text: `${LINE}\r` }), occurrence: 1 },
      { lineSha256: sha({ text: LINE }), occurrence: 1 },
      { lineSha256: sha({ text: `${LINE}\r` }), occurrence: 2 },
    ]);
  });

  it("refuses line zero and a line past the last", () => {
    expect([0, 6].map((line) => reviewedLineIdentity({ bytes: TWICE.bytes, line })._unsafeUnwrapErr().code)).toEqual([
      "LINE_OUT_OF_RANGE",
      "LINE_OUT_OF_RANGE",
    ]);
  });
});

describe("lineNumbersByDigest", () => {
  it("groups every line number by its digest, in file order", () => {
    expect(lineNumbersByDigest({ bytes: TWICE.bytes }).get(sha({ text: LINE }))).toEqual([2, 4]);
  });
});

describe("isPathListLocus", () => {
  it("names the bare locus and a withheld path's line, and nothing else", () => {
    expect(
      ["(file paths)", "(file paths) line 3", "src/(file paths)"].map((path) => isPathListLocus({ path })),
    ).toEqual([true, true, false]);
  });
});

describe("matchReviewedResidue — an anchored entry", () => {
  it("takes out its own line even when the identical copy is reported first", () => {
    const findings = [finding({ className: "topic", line: 2 }), finding({ className: "topic", line: 4 })];
    expect(matchOf({ ...SCOPE, entries: [anchored()], files: [TWICE], findings })).toEqual([[1], 0]);
  });

  it("takes nothing, and counts it, when its line's bytes changed", () => {
    const moved = fileOf({ lines: ["alpha", LINE, "beta", "changed", "gamma"] });
    const findings = [finding({ className: "topic", line: 2 })];
    expect(matchOf({ ...SCOPE, entries: [anchored()], files: [moved], findings })).toEqual([[], 1]);
  });

  it("is neither matched nor counted in another record or tree", () => {
    const findings = [finding({ className: "topic", line: 4 })];
    expect(matchOf({ ...ELSEWHERE, entries: [anchored()], files: [TWICE], findings })).toEqual([[], 0]);
  });
});

describe("matchReviewedResidue — an owner-address entry with its occurrence", () => {
  it("follows its occurrence in another cut after lines were added above it", () => {
    const shifted = fileOf({ lines: ["new", "new", "alpha", LINE, "beta", LINE] });
    const findings = [
      finding({ className: "owner-address", line: 4 }),
      finding({ className: "owner-address", line: 6 }),
    ];
    expect(matchOf({ ...ELSEWHERE, entries: [address({ occurrence: 2 })], files: [shifted], findings })).toEqual([
      [1],
      0,
    ]);
  });

  it("takes nothing, and counts it, when that occurrence no longer exists", () => {
    const once = fileOf({ lines: ["alpha", LINE] });
    const findings = [finding({ className: "owner-address", line: 2 })];
    expect(matchOf({ ...ELSEWHERE, entries: [address({ occurrence: 2 })], files: [once], findings })).toEqual([[], 1]);
  });

  it("takes nothing, and counts it, when only the other copy is flagged", () => {
    const findings = [finding({ className: "owner-address", line: 2 })];
    expect(matchOf({ ...ELSEWHERE, entries: [address({ occurrence: 2 })], files: [TWICE], findings })).toEqual([[], 1]);
  });
});

describe("matchReviewedResidue — an older owner-address entry with no occurrence", () => {
  const both = [finding({ className: "owner-address", line: 2 }), finding({ className: "owner-address", line: 4 })];

  it("binds to its stored line in its own record and tree", () => {
    expect(matchOf({ ...SCOPE, entries: [address()], files: [TWICE], findings: both })).toEqual([[1], 0]);
  });

  it("binds in another cut when the file holds exactly one copy", () => {
    const once = fileOf({ lines: ["alpha", "beta", LINE] });
    const findings = [finding({ className: "owner-address", line: 3 })];
    expect(matchOf({ ...ELSEWHERE, entries: [address()], files: [once], findings })).toEqual([[0], 0]);
  });

  it("fails closed in another cut over two copies, one entry or one for each", () => {
    const second = address({ entryId: "1c8f6f5d-7b9b-4e4f-8c2e-3a5b7d9f1b2c", lineNumberAtReview: 2 });
    expect([
      matchOf({ ...ELSEWHERE, entries: [address()], files: [TWICE], findings: both }),
      matchOf({ ...ELSEWHERE, entries: [address(), second], files: [TWICE], findings: both }),
    ]).toEqual([
      [[], 1],
      [[], 2],
    ]);
  });
});

describe("matchReviewedResidue — one finding, one entry", () => {
  it("lets only one of two entries bound to one line take it, and counts the other", () => {
    const twin = anchored({ entryId: "4e1b9c8d-0a2b-4c3d-8e4f-5a6b7c8d9e0f" });
    const findings = [finding({ className: "topic", line: 4 })];
    expect(matchOf({ ...SCOPE, entries: [anchored(), twin], files: [TWICE], findings })).toEqual([[0], 1]);
  });

  it("counts an entry naming no file of the cut", () => {
    const findings = [finding({ className: "topic", line: 4 })];
    expect(matchOf({ ...SCOPE, entries: [anchored({ path: "src/gone.ts" })], files: [TWICE], findings })).toEqual([
      [],
      1,
    ]);
  });
});

describe("reviewedResidueEntrySchema — occurrence", () => {
  it("reads an owner-address entry with or without one", () => {
    expect(
      [address(), address({ occurrence: 2 })].map((entry) => reviewedResidueEntrySchema.safeParse(entry).success),
    ).toEqual([true, true]);
  });

  it("refuses a zero, negative or fractional occurrence, and any occurrence on an anchored entry", () => {
    expect(
      [
        { ...address(), occurrence: 0 },
        { ...address(), occurrence: -1 },
        { ...address(), occurrence: 1.5 },
        { ...anchored(), occurrence: 1 },
      ].map((entry) => reviewedResidueEntrySchema.safeParse(entry).success),
    ).toEqual([false, false, false, false]);
  });
});
