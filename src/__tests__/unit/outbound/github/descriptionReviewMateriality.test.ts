/*
 * Whether an earlier CLEAN description review is carried over a change set that moved: the pure decision, the
 * stored-delta parser, and the one blind spot this design chose, pinned by name.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  changeDigestOf,
  type TreeDeltaEntry,
  treeDeltaLines,
} from "../../../../outbound/github/descriptionChangeDigest.js";
import { buildDescriptionManifest, manifestSha256Of } from "../../../../outbound/github/descriptionReview.js";
import {
  carriedCleanReview,
  packetDeltaCommit,
  parseStoredTreeDelta,
} from "../../../../outbound/github/descriptionReviewCarry.js";
import {
  CARRIED_REVIEW_BLIND_SPOT,
  carriedReviewNotice,
  type DescriptionClaimText,
  decideDescriptionMateriality,
  JUDGED_TREES,
  sameDescriptionInputs,
} from "../../../../outbound/github/descriptionReviewMateriality.js";
import {
  DESCRIPTION_RULE_FILES,
  type DescriptionReviewReceipt,
} from "../../../../outbound/github/descriptionReviewTypes.js";

const ZERO = "0".repeat(40);
const BLOB_A = "a".repeat(40);
const BLOB_B = "b".repeat(40);
const BLOB_C = "c".repeat(40);

/** One modified path, base side BLOB_A, head side as given. */
function modified({ path, newBlob }: { path: string; newBlob: string }): TreeDeltaEntry {
  return { newBlob, newMode: "100644", oldBlob: BLOB_A, oldMode: "100644", path, status: "M" };
}

const CLAIMS: DescriptionClaimText = {
  body: "Counts each widget once.\n",
  commentBodies: ["The counter reads each widget once."],
  imageProofs: ["the count after the fix"],
  title: "fix(widgets): count every widget once",
};

const CODE = modified({ newBlob: BLOB_B, path: "src/count.ts" });

/** The decision when one path moved from BLOB_B to BLOB_C beside an unchanged code path. */
function afterEdit({ path, claims = CLAIMS }: { path: string; claims?: DescriptionClaimText }) {
  return decideDescriptionMateriality({
    claims,
    currentEntries: [CODE, modified({ newBlob: BLOB_C, path })],
    reviewedEntries: [CODE, modified({ newBlob: BLOB_B, path })],
  });
}

describe("decideDescriptionMateriality", () => {
  it("carries a trim to Markdown the description never names, outside the judged trees", () => {
    expect(afterEdit({ path: "docs/guide.md" })).toStrictEqual({ changedPaths: ["docs/guide.md"], kind: "carry" });
  });

  it("KNOWN CARRIED CASE, chosen: a claim about trimmed prose rides when the description never names its file", () => {
    // The reviewed guide said "Requests retry three times."; the trim removed it; the unchanged body still says the
    // reference documents three retries. No syntactic rule can see that, so this carries, on purpose.
    const claims = { ...CLAIMS, body: "The reference documents three retries.\n" };
    expect(afterEdit({ claims, path: "docs/retries.md" })).toStrictEqual({
      changedPaths: ["docs/retries.md"],
      kind: "carry",
    });
    expect(CARRIED_REVIEW_BLIND_SPOT).toBe(
      "a claim about prose in a changed Markdown file the description never names can ride this earlier review unread",
    );
  });

  it("asks again for a changed path that is not Markdown", () => {
    expect(afterEdit({ path: "src/other.ts" })).toStrictEqual({
      kind: "review",
      reasons: ["src/other.ts changed and is not Markdown"],
    });
  });

  it("asks again for Markdown under a tree a description is judged against", () => {
    expect(afterEdit({ path: "skills/github/SKILL.md" })).toStrictEqual({
      kind: "review",
      reasons: ["skills/github/SKILL.md changed and holds text a description is judged against"],
    });
    expect(afterEdit({ path: ".claude/rules/testing.md" })).toStrictEqual({
      kind: "review",
      reasons: [".claude/rules/testing.md changed and holds text a description is judged against"],
    });
  });

  it("holds every written rule file under a judged tree", () => {
    expect(DESCRIPTION_RULE_FILES.length).toBeGreaterThan(0);
    expect(DESCRIPTION_RULE_FILES.filter((file) => !JUDGED_TREES.some((tree) => file.startsWith(tree)))).toEqual([]);
  });

  it("asks again when the title, body, a comment or a proves line names the file, in any case", () => {
    const named = ["Docs/Guide.md", "see docs/guide.md"];
    const surfaces: readonly DescriptionClaimText[] = [
      { ...CLAIMS, title: `${CLAIMS.title} ${named[0]!}` },
      { ...CLAIMS, body: named[1]! },
      { ...CLAIMS, commentBodies: [named[1]!] },
      { ...CLAIMS, imageProofs: ["GUIDE.MD rendered"] },
    ];
    expect(surfaces.map((claims) => afterEdit({ claims, path: "docs/guide.md" }))).toStrictEqual(
      surfaces.map(() => ({ kind: "review", reasons: ["docs/guide.md changed and the description names it"] })),
    );
  });

  it("asks again when the path set grows or shrinks", () => {
    const guide = modified({ newBlob: BLOB_B, path: "docs/guide.md" });
    expect(
      decideDescriptionMateriality({ claims: CLAIMS, currentEntries: [CODE, guide], reviewedEntries: [CODE] }),
    ).toStrictEqual({ kind: "review", reasons: ["the change set now also touches docs/guide.md"] });
    expect(
      decideDescriptionMateriality({ claims: CLAIMS, currentEntries: [CODE], reviewedEntries: [CODE, guide] }),
    ).toStrictEqual({ kind: "review", reasons: ["the change set no longer touches docs/guide.md"] });
  });

  it("asks again when a path's status, mode or base side moved, even in unnamed Markdown", () => {
    const reviewed = modified({ newBlob: BLOB_B, path: "docs/guide.md" });
    const moved: readonly TreeDeltaEntry[] = [
      { ...reviewed, newBlob: BLOB_C, oldBlob: BLOB_C },
      { ...reviewed, newMode: "100755" },
      { ...reviewed, oldBlob: ZERO, oldMode: "000000", status: "A" },
    ];
    expect(
      moved.map((current) =>
        decideDescriptionMateriality({ claims: CLAIMS, currentEntries: [current], reviewedEntries: [reviewed] }),
      ),
    ).toStrictEqual(
      moved.map(() => ({ kind: "review", reasons: ["docs/guide.md's status, mode or base-side content moved"] })),
    );
  });

  it("does not carry when no path's content moved at all", () => {
    expect(
      decideDescriptionMateriality({ claims: CLAIMS, currentEntries: [CODE], reviewedEntries: [CODE] }),
    ).toStrictEqual({ kind: "review", reasons: ["no path's content differs from the reviewed change set"] });
  });

  it("lists every reason, never the first", () => {
    expect(
      decideDescriptionMateriality({
        claims: CLAIMS,
        currentEntries: [
          modified({ newBlob: BLOB_C, path: "src/count.ts" }),
          modified({ newBlob: BLOB_C, path: "skills/z.md" }),
        ],
        reviewedEntries: [CODE, modified({ newBlob: BLOB_B, path: "skills/z.md" })],
      }),
    ).toStrictEqual({
      kind: "review",
      reasons: [
        "skills/z.md changed and holds text a description is judged against",
        "src/count.ts changed and is not Markdown",
      ],
    });
  });
});

describe("sameDescriptionInputs", () => {
  const base = {
    baseBranch: "main",
    body: "Counts once.\n",
    changeDigest: "1".repeat(64),
    comments: [],
    existingComments: [],
    images: [],
    repository: "acme/widgets",
    rulesSha256: "2".repeat(64),
    title: "fix: count once",
  };

  it("ignores only the change set", () => {
    const reviewed = buildDescriptionManifest(base);
    expect(
      sameDescriptionInputs({ reviewed, want: buildDescriptionManifest({ ...base, changeDigest: "3".repeat(64) }) }),
    ).toBe(true);
  });

  it("refuses any other input that moved", () => {
    const reviewed = buildDescriptionManifest(base);
    const moved = [
      { ...base, body: "Counts twice.\n" },
      { ...base, title: "fix: count twice" },
      { ...base, rulesSha256: "4".repeat(64) },
      { ...base, baseBranch: "release" },
      { ...base, comments: [{ body: "note", line: 1, path: "a.ts" }] },
    ];
    expect(moved.map((over) => sameDescriptionInputs({ reviewed, want: buildDescriptionManifest(over) }))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("parseStoredTreeDelta", () => {
  const entries: readonly TreeDeltaEntry[] = [CODE, modified({ newBlob: BLOB_B, path: "docs/a guide.md" })];
  const text = [`changeDigest ${changeDigestOf({ entries })}`, ...treeDeltaLines({ entries }), ""].join("\n");

  it("reads back exactly what a packet wrote, a path with a space included", () => {
    expect(unwrap(parseStoredTreeDelta({ text }))).toStrictEqual(
      entries.toSorted((left, right) => (left.path < right.path ? -1 : 1)),
    );
  });

  it("refuses a file whose lines no longer hash to the digest it names", () => {
    const edited = text.replace("docs/a guide.md", "docs/b guide.md");
    expect(unwrapErr(parseStoredTreeDelta({ text: edited })).message).toBe(
      "description review packet: change/delta.txt does not hash to the digest it names",
    );
  });

  it("refuses a file with no digest line, or one cut short", () => {
    expect(unwrapErr(parseStoredTreeDelta({ text: text.slice(text.indexOf("\n") + 1) })).message).toBe(
      "description review packet: change/delta.txt does not open on its digest line and end on a newline",
    );
    expect(unwrapErr(parseStoredTreeDelta({ text: text.slice(0, -1) })).message).toBe(
      "description review packet: change/delta.txt does not open on its digest line and end on a newline",
    );
  });

  it("refuses a line it cannot read rather than skipping it", () => {
    const garbled = text.replace(/\nM /, "\nR ");
    expect(unwrapErr(parseStoredTreeDelta({ text: garbled })).message).toContain(
      "change/delta.txt carries a line it cannot read: ",
    );
  });
});

describe("carriedCleanReview before any read", () => {
  const inputs = {
    baseBranch: "main",
    body: "Counts once.\n",
    comments: [],
    existingComments: [],
    images: [],
    repository: "acme/widgets",
    rulesSha256: "2".repeat(64),
    title: "fix: count once",
  };
  const want = buildDescriptionManifest({ ...inputs, changeDigest: "5".repeat(64) });

  /** A receipt over the same description and an older change set. */
  function receipt({
    receiptId,
    verdict,
    recordedAtIso,
  }: Pick<DescriptionReviewReceipt, "receiptId" | "verdict" | "recordedAtIso">): DescriptionReviewReceipt {
    const manifest = buildDescriptionManifest({ ...inputs, changeDigest: "6".repeat(64) });
    return {
      manifest,
      manifestSha256: manifestSha256Of({ manifest }),
      preparationId: `prep-${receiptId}`,
      preparedBy: null,
      receiptId,
      recordedAtIso,
      recordedBy: null,
      reviewId: `pass-${receiptId}`,
      reviewer: "codex",
      schemaVersion: 2,
      summary: "",
      verdict,
    };
  }

  const carry = ({ receipts }: { receipts: readonly DescriptionReviewReceipt[] }) =>
    carriedCleanReview({ claims: CLAIMS, currentEntries: [CODE], home: "/nonexistent-home", receipts, want });

  it("finds nothing to carry when no review covers the same description", () => {
    expect(carry({ receipts: [] })).toStrictEqual({ kind: "none", reasons: [] });
  });

  it("refuses when the newest review of the same description is BROKEN, never reaching behind it", () => {
    const older = receipt({ receiptId: "r-1", recordedAtIso: "2026-11-01T00:00:00.000Z", verdict: "CLEAN" });
    const newer = receipt({ receiptId: "r-2", recordedAtIso: "2026-11-02T00:00:00.000Z", verdict: "BROKEN" });
    expect(carry({ receipts: [older, newer] })).toStrictEqual({
      kind: "none",
      reasons: ["the newest review of this same description, r-2, is BROKEN"],
    });
  });
});

describe("packetDeltaCommit", () => {
  const manifest = buildDescriptionManifest({
    baseBranch: "main",
    body: "Counts once.\n",
    changeDigest: "5".repeat(64),
    comments: [],
    existingComments: [],
    images: [],
    repository: "acme/widgets",
    rulesSha256: "2".repeat(64),
    title: "fix: count once",
  });
  const fields = {
    baseSha: "b".repeat(40),
    createdAtIso: "2026-11-28T00:00:00.000Z",
    headSha: "h".repeat(40),
    manifest,
    manifestSha256: manifestSha256Of({ manifest }),
    preparationId: "prep-1",
    preparedBy: null,
  };

  it("reads a schema-3 packet's delta at its head, where every text file rides the diff", () => {
    expect(packetDeltaCommit({ preparation: { ...fields, schemaVersion: 3 } })).toBe("h".repeat(40));
  });

  it("reads a schema-2 packet's delta at its base, where it was committed before the layout moved", () => {
    expect(packetDeltaCommit({ preparation: { ...fields, schemaVersion: 2 } })).toBe("b".repeat(40));
  });
});

describe("carriedReviewNotice", () => {
  it("names the receipt, the paths and the blind spot in one line", () => {
    expect(carriedReviewNotice({ changedPaths: ["docs/a.md", "docs/b.md"], receiptId: "r-1" })).toBe(
      "description review: the description is unchanged, so CLEAN receipt r-1 still covers it over a change set " +
        "that moved only in docs/a.md, docs/b.md. Blind spot: a claim about prose in a changed Markdown file the " +
        "description never names can ride this earlier review unread.",
    );
  });
});
