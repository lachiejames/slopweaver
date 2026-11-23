/**
 * The reviewed-residue list's file store, round-tripped through a throwaway home: an absent list is empty, an
 * appended entry reads back with the digest of the exact bytes, and any bad line refuses the whole list.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewedResidueEntry } from "../../../freshCut/reviewedResidue.js";
import {
  appendReviewedResidue,
  readReviewedResidue,
  reviewedResiduePath,
} from "../../../freshCut/reviewedResidueStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const ENTRY: ReviewedResidueEntry = {
  className: "owner-address",
  entryId: "0b7e5e4c-6a8a-4d3e-9b1d-2f4a6c8e0a1b",
  judgement: "placeholder",
  lineNumberAtReview: 7,
  lineSha256: "b".repeat(64),
  path: "src/a.test.ts",
  reviewedAtIso: "2026-11-20T01:02:03.000Z",
  reviewedBySessionId: "session-1",
  reviewedRecordId: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  reviewedTreeSha: "a".repeat(40),
  schemaVersion: 1,
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "residue-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write raw lines to the list, creating its directory. */
const writeRaw = ({ text }: { text: string }): void => {
  const path = reviewedResiduePath({ home });
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, text);
};

describe("readReviewedResidue", () => {
  it("reads an absent list as empty, with the digest of no bytes", () => {
    expect(unwrap(readReviewedResidue({ home }))).toEqual({
      entries: [],
      sha256: createHash("sha256").digest("hex"),
    });
  });

  it("reads back an appended entry, with the digest of the exact file bytes", () => {
    unwrap(appendReviewedResidue({ entry: ENTRY, home }));
    const bytes = readFileSync(reviewedResiduePath({ home }));
    expect(unwrap(readReviewedResidue({ home }))).toEqual({
      entries: [ENTRY],
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("refuses the whole list when one line is of another class", () => {
    unwrap(appendReviewedResidue({ entry: ENTRY, home }));
    writeRaw({
      text: `${JSON.stringify({ ...ENTRY, className: "topic", entryId: "1c8f6f5d-7b9b-4e4f-8c2e-3a5b7d9f1b2c" })}\n`,
    });
    const error = unwrapErr(readReviewedResidue({ home }));
    expect(error.code).toBe("REVIEWED_RESIDUE_UNREADABLE");
    expect(error.message).toContain("line 2 is not an owner-address entry");
  });

  it("refuses the whole list when a line is not JSON", () => {
    writeRaw({ text: "not json\n" });
    expect(unwrapErr(readReviewedResidue({ home })).message).toContain("line 1 is not JSON");
  });

  it("refuses the whole list, valid entry and all, when a blank line sits inside it", () => {
    unwrap(appendReviewedResidue({ entry: ENTRY, home }));
    writeRaw({ text: "\n" });
    const error = unwrapErr(readReviewedResidue({ home }));
    expect(error.code).toBe("REVIEWED_RESIDUE_UNREADABLE");
    expect(error.message).toContain("line 2 is blank");
  });

  it("refuses a whitespace-only line, which is no entry", () => {
    unwrap(appendReviewedResidue({ entry: ENTRY, home }));
    writeRaw({ text: "  \n" });
    expect(unwrapErr(readReviewedResidue({ home })).message).toContain("line 2 is not JSON");
  });

  it("refuses a repeated entry id", () => {
    unwrap(appendReviewedResidue({ entry: ENTRY, home }));
    unwrap(appendReviewedResidue({ entry: ENTRY, home }));
    expect(unwrapErr(readReviewedResidue({ home })).message).toContain("line 2 repeats an entry id");
  });
});

describe("appendReviewedResidue", () => {
  it("creates the list owner-only", () => {
    unwrap(appendReviewedResidue({ entry: ENTRY, home }));
    expect(statSync(reviewedResiduePath({ home })).mode & 0o777).toBe(0o600);
  });

  it("refuses an entry of another class rather than writing it", () => {
    const bad = { ...ENTRY, className: "topic" } as unknown as ReviewedResidueEntry;
    expect(unwrapErr(appendReviewedResidue({ entry: bad, home })).code).toBe("REVIEWED_RESIDUE_WRITE_FAILED");
  });
});
