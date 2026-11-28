/*
 * The description review's pure half: what one review is bound to, whether a cited review judged this packet,
 * whether its reviewer was fresh, and whether a write may go out on the receipt the store holds.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { changeDigestOf, parseTreeDelta, treeDeltaLines } from "../../../../outbound/github/descriptionChangeDigest.js";
import {
  bindDescriptionReview,
  buildDescriptionManifest,
  decideDescriptionWrite,
  decideReviewerFreshness,
  descriptionReceiptOf,
  manifestDifferences,
  manifestSha256Of,
  nearestReceipt,
  rulesSha256Of,
  textSha256,
} from "../../../../outbound/github/descriptionReview.js";
import { isDescriptionReviewReceipt } from "../../../../outbound/github/descriptionReviewStore.js";
import {
  DESCRIPTION_REVIEW_EVERY_VIOLATION,
  DESCRIPTION_REVIEW_PACKET_README,
  DESCRIPTION_REVIEW_PROPERTY,
  DESCRIPTION_REVIEW_PROPERTY_ID,
  DESCRIPTION_RULE_FILES,
  type DescriptionImage,
  type DescriptionReviewComment,
  type DescriptionReviewManifest,
  type DescriptionReviewPreparation,
  type ExistingPullRequestComment,
  type HistoryBoundReceipt,
} from "../../../../outbound/github/descriptionReviewTypes.js";
import type { PageReviewCandidate } from "../../../../pages/review.js";

const IMAGE_A: DescriptionImage = {
  proves: "The connect page loads after consent.",
  receiptId: "upload-a",
  sha256: "a".repeat(64),
  url: "https://github.com/user-attachments/assets/a",
};
const IMAGE_B: DescriptionImage = {
  proves: "The error no longer appears.",
  receiptId: "upload-b",
  sha256: "b".repeat(64),
  url: "https://github.com/user-attachments/assets/b",
};

/** A manifest over fixed values, with any input overridden. */
function manifest(
  over: Partial<{
    title: string;
    body: string;
    changeDigest: string;
    rulesSha256: string;
    images: DescriptionImage[];
    comments: DescriptionReviewComment[];
    existingComments: ExistingPullRequestComment[];
  }> = {},
): DescriptionReviewManifest {
  return buildDescriptionManifest({
    baseBranch: "main",
    body: "Outlook connect failed after consent for a personal account.",
    changeDigest: "c".repeat(64),
    comments: [],
    existingComments: [],
    images: [IMAGE_A, IMAGE_B],
    repository: "acme/widgets",
    rulesSha256: "r".repeat(64),
    title: "fix(outlook): keep the session after consent",
    ...over,
  });
}

const PREPARED_BY = { host: "claude-code" as const, id: "a0000006-0000-4000-8000-000000000007" };
const OTHER_SESSION = { host: "claude-code" as const, id: "a0000008-0000-4000-8000-000000000009" };

/** The preparation a packet over {@link manifest} would have written. */
function preparation(over: Partial<DescriptionReviewPreparation> = {}): DescriptionReviewPreparation {
  const built = manifest();
  return {
    baseSha: "1".repeat(40),
    createdAtIso: "2026-11-17T01:00:00.000Z",
    headSha: "2".repeat(40),
    historicalReviewThreadIds: [],
    manifest: built,
    manifestSha256: manifestSha256Of({ manifest: built }),
    preparationId: "prep-1",
    preparedBy: PREPARED_BY,
    schemaVersion: 4,
    ...over,
  };
}

/** A review candidate over the fixture packet. */
function candidate(over: Partial<PageReviewCandidate> = {}): PageReviewCandidate {
  return {
    baseSha: "1".repeat(40),
    completedAtIso: "2026-11-17T01:05:00.000Z",
    diffSha256: "d".repeat(64),
    headSha: "2".repeat(40),
    id: "pass-1",
    pass: "r1",
    property: { id: DESCRIPTION_REVIEW_PROPERTY_ID, statement: DESCRIPTION_REVIEW_PROPERTY },
    repoRoot: "/h/pr-description-reviews/preparations/prep-1/repo",
    reviewer: "codex",
    summary: "Every claim matches the change set.",
    verdict: "CLEAN",
    ...over,
  };
}

const FACTS = {
  bodySha256: manifest().bodySha256,
  commentsSha256: manifest().commentsSha256,
  diffSha256: "d".repeat(64),
  titleSha256: manifest().titleSha256,
};

/** A receipt over a manifest, recorded at an instant. */
function receipt({
  of,
  verdict = "CLEAN",
  recordedAtIso = "2026-11-17T01:06:00.000Z",
  receiptId = "receipt-1",
}: {
  of: DescriptionReviewManifest;
  verdict?: "CLEAN" | "BROKEN";
  recordedAtIso?: string;
  receiptId?: string;
}): HistoryBoundReceipt {
  return descriptionReceiptOf({
    candidate: candidate({ summary: verdict === "CLEAN" ? "all five hold" : "the body says we fixed it", verdict }),
    preparation: preparation({ manifest: of, manifestSha256: manifestSha256Of({ manifest: of }) }),
    receiptId,
    recordedAtIso,
    recordedBy: OTHER_SESSION,
  });
}

describe("what a BROKEN description review owes", () => {
  it("asks for every violation, numbered, in both fields, each with its line and the check it breaks", () => {
    expect(DESCRIPTION_REVIEW_EVERY_VIOLATION).toContain("never stop at the first violation");
    expect(DESCRIPTION_REVIEW_EVERY_VIOLATION).toContain(
      "lists EVERY violation found, numbered, in both evidence and counterexample",
    );
    expect(DESCRIPTION_REVIEW_EVERY_VIOLATION).toContain("the check or rules/ ruling it breaks");
  });

  it("closes the property the reviewer answers, after the five checks", () => {
    expect(DESCRIPTION_REVIEW_PROPERTY.endsWith(`For this property: ${DESCRIPTION_REVIEW_EVERY_VIOLATION}`)).toBe(true);
  });

  it("sits in the packet README after the five questions, not in place of them", () => {
    const fifth = DESCRIPTION_REVIEW_PACKET_README.indexOf("5. Does it break a written ruling in `rules/`?");
    const owed = DESCRIPTION_REVIEW_PACKET_README.indexOf(`${DESCRIPTION_REVIEW_EVERY_VIOLATION}.`);
    expect(fifth).toBeGreaterThan(0);
    expect(owed).toBeGreaterThan(fifth);
    expect(DESCRIPTION_REVIEW_PACKET_README).toContain("A single failure is BROKEN");
  });

  it("carries the badge rule file, so a derived phrase is read by its meaning and its field is still judged", () => {
    expect(DESCRIPTION_RULE_FILES.filter((file) => file.endsWith("/pr-badges.md"))).toStrictEqual([
      "skills/github/reference/pr-badges.md",
    ]);
    expect(DESCRIPTION_REVIEW_PACKET_README).toContain("judge the field behind it, not the template's wording");
    expect(DESCRIPTION_REVIEW_PACKET_README).toContain(
      "`Who ran it isn't recorded.` is the honest answer when nothing records who ran it, never an attribution failure.",
    );
  });

  it("keeps whether a capture should have been gathered off the description, judging a reason on truth", () => {
    expect(DESCRIPTION_REVIEW_PACKET_README).toContain(
      "Whether more proof should have been gathered is the landing grade's question, kept off the description",
    );
    expect(DESCRIPTION_REVIEW_PACKET_README).toContain(
      "judged only on whether it is true of `change/` and `evidence/`",
    );
    expect(DESCRIPTION_REVIEW_PACKET_README).toContain("`evidence/01-fleet-finding.json`");
  });
});

describe("buildDescriptionManifest", () => {
  it("binds the exact title and body bytes by digest", () => {
    const built = manifest();
    expect(built.titleSha256).toBe(textSha256({ text: "fix(outlook): keep the session after consent" }));
    expect(built.bodySha256).toBe(textSha256({ text: "Outlook connect failed after consent for a personal account." }));
  });

  it("is the same packet whatever order the images are given in", () => {
    const forwards = manifestSha256Of({ manifest: manifest({ images: [IMAGE_A, IMAGE_B] }) });
    const backwards = manifestSha256Of({ manifest: manifest({ images: [IMAGE_B, IMAGE_A] }) });
    expect(backwards).toBe(forwards);
    expect(manifest({ images: [IMAGE_B, IMAGE_A] }).images.map((image) => image.receiptId)).toStrictEqual([
      "upload-a",
      "upload-b",
    ]);
  });

  it("is a different packet when one byte of the body changes", () => {
    const before = manifestSha256Of({ manifest: manifest() });
    const after = manifestSha256Of({
      manifest: manifest({ body: "Outlook connect failed after consent for a personal account!" }),
    });
    expect(after).not.toBe(before);
  });

  it("is a different packet when an image's proves line changes", () => {
    const reworded = { ...IMAGE_A, proves: "The connect page loads." };
    expect(manifestSha256Of({ manifest: manifest({ images: [reworded, IMAGE_B] }) })).not.toBe(
      manifestSha256Of({ manifest: manifest() }),
    );
  });
});

describe("isDescriptionReviewReceipt", () => {
  it("takes a receipt that binds the comments", () => {
    expect(isDescriptionReviewReceipt(receipt({ of: manifest() }))).toBe(true);
  });

  it("records the threads its reviewer was told are history, copied from the packet", () => {
    const built = manifest();
    const recorded = descriptionReceiptOf({
      candidate: candidate(),
      preparation: preparation({ historicalReviewThreadIds: ["PRRT_1", "PRRT_2"] }),
      receiptId: "receipt-h",
      recordedAtIso: "2026-11-17T01:06:00.000Z",
      recordedBy: OTHER_SESSION,
    });
    expect(recorded.schemaVersion).toBe(3);
    expect(recorded.historicalReviewThreadIds).toStrictEqual(["PRRT_1", "PRRT_2"]);
    expect(recorded.manifestSha256).toBe(manifestSha256Of({ manifest: built }));
    expect(isDescriptionReviewReceipt(recorded)).toBe(true);
  });

  it("still takes a schema-2 receipt, recorded before history was shown, which carries no history field", () => {
    const { historicalReviewThreadIds: _history, ...fields } = receipt({ of: manifest() });
    expect(isDescriptionReviewReceipt({ ...fields, schemaVersion: 2 })).toBe(true);
    expect(isDescriptionReviewReceipt({ ...fields, historicalReviewThreadIds: [], schemaVersion: 2 })).toBe(false);
  });

  it("refuses a schema-3 receipt whose history names a thread twice, or names none at all", () => {
    const current = receipt({ of: manifest() });
    const { historicalReviewThreadIds: _history, ...fields } = current;
    expect(isDescriptionReviewReceipt({ ...current, historicalReviewThreadIds: ["PRRT_1", "PRRT_1"] })).toBe(false);
    expect(isDescriptionReviewReceipt({ ...current, historicalReviewThreadIds: [""] })).toBe(false);
    expect(isDescriptionReviewReceipt(fields)).toBe(false);
  });

  it("refuses a schema-1 receipt, which never certified any comment", () => {
    const current = receipt({ of: manifest() });
    const { commentsSha256: _posted, existingCommentsSha256: _existing, ...legacyManifest } = current.manifest;
    const legacy = { ...current, manifest: { ...legacyManifest, schemaVersion: 1 }, schemaVersion: 1 };
    expect(isDescriptionReviewReceipt(legacy)).toBe(false);
  });
});

describe("rulesSha256Of", () => {
  it("moves when one rule file's bytes move, and not otherwise", () => {
    const files = [
      { contents: "rule one\n", path: "skills/github/reference/pull-requests.md" },
      { contents: "rule two\n", path: ".claude/rules/area-outbound.md" },
    ];
    const same = rulesSha256Of({ files: files.map((file) => ({ ...file })) });
    const edited = rulesSha256Of({ files: [files[0]!, { ...files[1]!, contents: "rule two, amended\n" }] });
    expect(rulesSha256Of({ files })).toBe(same);
    expect(edited).not.toBe(same);
  });
});

describe("manifestDifferences", () => {
  it("names every part that differs and nothing else", () => {
    const want = manifest({ body: "a new body", changeDigest: "e".repeat(64) });
    expect(manifestDifferences({ have: manifest(), want })).toStrictEqual([
      "the body changed",
      "the change set's content changed",
    ]);
  });

  it("names the title, images and rules", () => {
    const want = manifest({ images: [IMAGE_A], rulesSha256: "s".repeat(64), title: "fix(outlook): another title" });
    expect(manifestDifferences({ have: manifest(), want })).toStrictEqual([
      "the title changed",
      "the images changed",
      "the written rules changed",
    ]);
  });

  it("is empty for the same packet", () => {
    expect(manifestDifferences({ have: manifest(), want: manifest() })).toStrictEqual([]);
  });
});

describe("bindDescriptionReview", () => {
  it("binds a review whose commits, diff, title and body are the packet's", () => {
    const bound = unwrap(bindDescriptionReview({ candidate: candidate(), facts: FACTS, preparation: preparation() }));
    expect(bound.candidate.id).toBe("pass-1");
    expect(bound.preparation.preparationId).toBe("prep-1");
  });

  it("refuses a review that answered a narrower property", () => {
    const narrow = candidate({ property: { id: DESCRIPTION_REVIEW_PROPERTY_ID, statement: "the title is short" } });
    const failure = unwrapErr(bindDescriptionReview({ candidate: narrow, facts: FACTS, preparation: preparation() }));
    expect(failure.code).toBe("REVIEW_WRONG_PACKET");
    expect(failure.message).toContain("not the five-question property");
  });

  it("refuses a review that answered the five questions without owing every violation", () => {
    const beforeEveryViolation = DESCRIPTION_REVIEW_PROPERTY.slice(
      0,
      DESCRIPTION_REVIEW_PROPERTY.indexOf(" For this property: "),
    );
    const stale = candidate({ property: { id: DESCRIPTION_REVIEW_PROPERTY_ID, statement: beforeEveryViolation } });
    const failure = unwrapErr(bindDescriptionReview({ candidate: stale, facts: FACTS, preparation: preparation() }));
    expect(
      beforeEveryViolation.endsWith("so open each one images.json names in the repository the review names."),
    ).toBe(true);
    expect(failure.code).toBe("REVIEW_WRONG_PACKET");
  });

  it("refuses a new review of a schema-2 packet, whose evidence sits outside the diff, naming the re-prepare", () => {
    const { historicalReviewThreadIds: _history, ...historyFree } = preparation();
    const stored = { ...historyFree, schemaVersion: 2 as const };
    const failure = unwrapErr(bindDescriptionReview({ candidate: candidate(), facts: FACTS, preparation: stored }));
    expect(failure.code).toBe("REVIEW_WRONG_PACKET");
    expect(failure.message).toContain(
      "its packet prep-1 keeps its evidence at the base commit, outside the diff; run `github pr review-prepare` again",
    );
  });

  it("refuses a new review of a schema-3 packet, which showed no thread's history, naming the re-prepare", () => {
    const { historicalReviewThreadIds: _history, ...historyFree } = preparation();
    const stored = { ...historyFree, schemaVersion: 3 as const };
    const failure = unwrapErr(bindDescriptionReview({ candidate: candidate(), facts: FACTS, preparation: stored }));
    expect(failure.code).toBe("REVIEW_WRONG_PACKET");
    expect(failure.message).toContain(
      "its packet prep-1 shows no review thread's history, so a resolved comment reads as live; run `github pr review-prepare` again",
    );
  });

  it("refuses a review of other commits", () => {
    const other = candidate({ headSha: "3".repeat(40) });
    const failure = unwrapErr(bindDescriptionReview({ candidate: other, facts: FACTS, preparation: preparation() }));
    expect(failure.message).toContain("are not the ones `github pr review-prepare` committed");
  });

  it("refuses a review whose diff does not reproduce from the commits", () => {
    const facts = { ...FACTS, diffSha256: "9".repeat(64) };
    const failure = unwrapErr(bindDescriptionReview({ candidate: candidate(), facts, preparation: preparation() }));
    expect(failure.message).toContain("the packet was edited before the review ran");
  });

  it("refuses a head commit whose comments are not the prepared ones", () => {
    const facts = { ...FACTS, commentsSha256: "7".repeat(64) };
    const failure = unwrapErr(bindDescriptionReview({ candidate: candidate(), facts, preparation: preparation() }));
    expect(failure.code).toBe("REVIEW_WRONG_PACKET");
    expect(failure.message).toContain("the comments at its head commit are not the ones that were prepared");
  });

  it("refuses a head commit whose body is not the prepared description", () => {
    const facts = { ...FACTS, bodySha256: "8".repeat(64) };
    const failure = unwrapErr(bindDescriptionReview({ candidate: candidate(), facts, preparation: preparation() }));
    expect(failure.message).toContain("is not the description that was prepared");
  });
});

describe("decideReviewerFreshness", () => {
  it("takes a Codex review whoever records it, the preparer included", () => {
    const decided = decideReviewerFreshness({ preparedBy: PREPARED_BY, recordedBy: PREPARED_BY, reviewer: "codex" });
    expect(unwrap(decided)).toBe("codex");
  });

  it("refuses a Claude fallback review recorded by the session that prepared the packet", () => {
    const decided = decideReviewerFreshness({
      preparedBy: PREPARED_BY,
      recordedBy: PREPARED_BY,
      reviewer: "claude-fallback",
    });
    const failure = unwrapErr(decided);
    expect(failure.code).toBe("REVIEWER_NOT_FRESH");
    expect(failure.message).toContain(`session ${PREPARED_BY.id} prepared this packet`);
  });

  it("takes a Claude fallback review recorded by a different visible session", () => {
    const decided = decideReviewerFreshness({
      preparedBy: PREPARED_BY,
      recordedBy: OTHER_SESSION,
      reviewer: "claude-fallback",
    });
    expect(unwrap(decided)).toBe("claude-fallback");
  });

  it("reads the same id under another host as another session", () => {
    const codexThread = { host: "codex" as const, id: PREPARED_BY.id };
    const decided = decideReviewerFreshness({
      preparedBy: PREPARED_BY,
      recordedBy: codexThread,
      reviewer: "claude-fallback",
    });
    expect(unwrap(decided)).toBe("claude-fallback");
  });

  it("refuses a fallback review when the recording session cannot be named", () => {
    const failure = unwrapErr(
      decideReviewerFreshness({ preparedBy: PREPARED_BY, recordedBy: null, reviewer: "claude-fallback" }),
    );
    expect(failure.message).toContain("names no visible session");
  });

  it("refuses a fallback review of a packet prepared outside any visible session", () => {
    const failure = unwrapErr(
      decideReviewerFreshness({ preparedBy: null, recordedBy: OTHER_SESSION, reviewer: "claude-fallback" }),
    );
    expect(failure.message).toContain("prepared outside any visible session");
  });
});

describe("decideDescriptionWrite", () => {
  it("opens the write on a CLEAN receipt for these exact bytes", () => {
    const want = manifest();
    const opened = unwrap(decideDescriptionWrite({ receipt: receipt({ of: want }), receipts: [], want }));
    expect(opened.verdict).toBe("CLEAN");
  });

  it("refuses on a BROKEN receipt, naming the reviewer's summary and the absent hatch", () => {
    const want = manifest();
    const failure = unwrapErr(
      decideDescriptionWrite({ receipt: receipt({ of: want, verdict: "BROKEN" }), receipts: [], want }),
    );
    expect(failure.code).toBe("REVIEW_BROKEN");
    expect(failure.message).toContain("the body says we fixed it");
    expect(failure.message).toContain("There is no escape hatch");
  });

  it("refuses with no receipt, saying what moved since the last review of this description", () => {
    const reviewed = manifest();
    const want = manifest({ changeDigest: "e".repeat(64) });
    const failure = unwrapErr(
      decideDescriptionWrite({ receipt: undefined, receipts: [receipt({ of: reviewed })], want }),
    );
    expect(failure.code).toBe("REVIEW_MISSING");
    expect(failure.message).toContain("the change set's content changed");
    expect(failure.message).toContain("slopweaver github pr review-prepare");
  });

  it("refuses with no receipt and no history, naming no differences", () => {
    const failure = unwrapErr(decideDescriptionWrite({ receipt: undefined, receipts: [], want: manifest() }));
    expect(failure.code).toBe("REVIEW_MISSING");
    expect(failure.message).toContain("written rules and change set this write sends). Run");
  });
});

describe("nearestReceipt", () => {
  it("prefers a review of the same text over a newer review of other text", () => {
    const want = manifest({ changeDigest: "e".repeat(64) });
    const sameText = receipt({ of: manifest(), receiptId: "same-text", recordedAtIso: "2026-11-17T01:00:00.000Z" });
    const newer = receipt({
      of: manifest({ body: "other" }),
      receiptId: "newer",
      recordedAtIso: "2026-11-17T02:00:00.000Z",
    });
    expect(nearestReceipt({ receipts: [newer, sameText], want })!.receiptId).toBe("same-text");
  });

  it("ignores another repository's reviews", () => {
    const foreign = receipt({ of: { ...manifest(), repository: "acme/other" } });
    expect(nearestReceipt({ receipts: [foreign], want: manifest() })).toBe(undefined);
  });
});

describe("parseTreeDelta and changeDigestOf", () => {
  const raw =
    `:100644 100644 ${"1".repeat(40)} ${"2".repeat(40)} M\0src/a.ts\0` +
    `:000000 100755 ${"0".repeat(40)} ${"3".repeat(40)} A\0bin/run\0`;

  it("reads each raw record into its six fields", () => {
    const entries = unwrap(parseTreeDelta({ raw }));
    expect(entries).toStrictEqual([
      {
        newBlob: "2".repeat(40),
        newMode: "100644",
        oldBlob: "1".repeat(40),
        oldMode: "100644",
        path: "src/a.ts",
        status: "M",
      },
      {
        newBlob: "3".repeat(40),
        newMode: "100755",
        oldBlob: "0".repeat(40),
        oldMode: "000000",
        path: "bin/run",
        status: "A",
      },
    ]);
    expect(treeDeltaLines({ entries })[0]).toBe(`A 000000 100755 ${"0".repeat(40)} ${"3".repeat(40)} bin/run`);
  });

  it("digests the same delta the same whatever order git printed it in", () => {
    const entries = unwrap(parseTreeDelta({ raw }));
    expect(changeDigestOf({ entries: entries.toReversed() })).toBe(changeDigestOf({ entries }));
  });

  it("reads an empty delta as no entries", () => {
    expect(unwrap(parseTreeDelta({ raw: "" }))).toStrictEqual([]);
  });

  it("refuses a record it cannot read rather than skipping it", () => {
    const failure = unwrapErr(parseTreeDelta({ raw: ":100644 100644 short short R100\0a\0b\0" }));
    expect(failure.code).toBe("CHANGE_DIGEST_FAILED");
    expect(failure.message).toContain("unreadable tree-delta record");
  });
});
