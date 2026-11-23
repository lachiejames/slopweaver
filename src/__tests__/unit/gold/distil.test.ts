import { describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../corpus/types.js";
import {
  type BatchDigest,
  buildDigestPrompt,
  DISTIL_RECORD_CHARS,
  digestPromptTruncation,
  reduceToSourceDigest,
  validateBatchDigest,
} from "../../../gold/distil.js";
import type { DistilBatch } from "../../../gold/distilGroup.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const rec: CorpusRecord = {
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "did a thing",
  tsIso: "2024-06-01T00:00:00Z",
  url: "u",
};
const batch: DistilBatch = { container: "o/r", hash: "h1", records: [rec], source: "github" };

describe("validateBatchDigest", () => {
  it("keeps only cited points and drops uncited ones", () => {
    const digest = unwrap(
      validateBatchDigest({
        batch,
        input: {
          points: [
            { citations: ["u1"], point: "p1" },
            { citations: [], point: "p2" },
          ],
          summary: "s",
        },
      }),
    );
    expect(digest.points).toEqual([{ citations: ["u1"], point: "p1" }]);
  });

  it("errs when neither a summary nor a cited point survives", () => {
    expect(
      unwrapErr(validateBatchDigest({ batch, input: { points: [{ citations: [], point: "p" }], summary: "" } })).code,
    ).toBe("DISTIL_DIGEST_EMPTY");
  });

  it("errs when the input has no string summary or no points array", () => {
    expect(unwrapErr(validateBatchDigest({ batch, input: { points: [] } })).code).toBe("DISTIL_DIGEST_SHAPE_INVALID");
    expect(unwrapErr(validateBatchDigest({ batch, input: { summary: "s" } })).code).toBe("DISTIL_DIGEST_SHAPE_INVALID");
  });

  it("drops a point with an empty/whitespace-only text even when it carries a citation", () => {
    const digest = unwrap(
      validateBatchDigest({ batch, input: { points: [{ citations: ["u"], point: "   " }], summary: "s" } }),
    );
    expect(digest.points).toEqual([]);
  });
});

describe("buildDigestPrompt", () => {
  it("includes the container and the record body", () => {
    const { user } = buildDigestPrompt({ batch });
    expect(user).toContain("Container: o/r");
    expect(user).toContain("did a thing");
  });

  it("renders a curated record's classification tag so gold can weight it (PR4.3)", () => {
    const tagged: CorpusRecord = { ...rec, attrs: { classification: "decision" }, kind: "discussion" };
    const { user } = buildDigestPrompt({ batch: { ...batch, records: [tagged] } });
    expect(user).toContain("[decision]");
  });

  it("omits the classification tag for an ordinary untagged record", () => {
    const { user } = buildDigestPrompt({ batch });
    expect(user.includes("[decision]") || user.includes("[strategy]")).toBe(false);
  });

  it("truncates a record body at DISTIL_RECORD_CHARS — exactly what digestPromptTruncation reports", () => {
    const tail = "CONCLUSION-AT-THE-BOTTOM";
    const long: CorpusRecord = { ...rec, text: `${"a".repeat(DISTIL_RECORD_CHARS)}${tail}` };
    const { user } = buildDigestPrompt({ batch: { ...batch, records: [long] } });
    expect(user).toContain("a".repeat(DISTIL_RECORD_CHARS));
    expect(user.includes(tail)).toBe(false);
  });
});

describe("digestPromptTruncation (pure)", () => {
  it("reports nothing truncated for a plan of short records", () => {
    expect(digestPromptTruncation({ batches: [batch] })).toStrictEqual({
      cap: DISTIL_RECORD_CHARS,
      droppedChars: 0,
      keptChars: "did a thing".length,
      longest: "did a thing".length,
      measured: 1,
      truncated: 0,
    });
  });

  it("counts EXACTLY what the prompt truncated, across every batch in the plan — per BATCH, not per record", () => {
    const over = ({ extra, sourceId }: { extra: number; sourceId: string }): CorpusRecord => ({
      ...rec,
      sourceId,
      text: "a".repeat(DISTIL_RECORD_CHARS + extra),
    });
    const truncation = digestPromptTruncation({
      batches: [
        { ...batch, hash: "h1", records: [over({ extra: 300, sourceId: "#1" }), rec] },
        { ...batch, hash: "h2", records: [over({ extra: 40_000, sourceId: "#2" })] },
      ],
    });

    // The 1,500-char record shares a batch with an 11-char one, so the budget it could not spend goes to
    // the record that wants it: 2 records buy 2,400 characters, and 1,511 are needed. Nothing is cut. Under
    // the old flat cap this same record lost 300 characters while 1,189 of its neighbour's went unused.
    expect(truncation.measured).toBe(3);
    expect(truncation.truncated).toBe(1);
    expect(truncation.droppedChars).toBe(40_000);
    expect(truncation.keptChars).toBe(DISTIL_RECORD_CHARS + 300 + "did a thing".length + DISTIL_RECORD_CHARS);
    expect(truncation.longest).toBe(DISTIL_RECORD_CHARS + 40_000);
  });

  it("counts the title and its joining newline, which consume the same cap", () => {
    const titled: CorpusRecord = { ...rec, text: "body", title: "Title" };
    expect(digestPromptTruncation({ batches: [{ ...batch, records: [titled] }] }).longest).toBe("Title\nbody".length);
  });

  it("measures the PLAN, not the corpus — an empty plan reports nothing measured rather than a clean cap", () => {
    expect(digestPromptTruncation({ batches: [] })).toStrictEqual({
      cap: DISTIL_RECORD_CHARS,
      droppedChars: 0,
      keptChars: 0,
      longest: 0,
      measured: 0,
      truncated: 0,
    });
  });
});

describe("reduceToSourceDigest", () => {
  it("orders containers by point count desc", () => {
    const thin: BatchDigest = {
      container: "a",
      points: [{ citations: ["u"], point: "p" }],
      source: "github",
      summary: "s",
    };
    const rich: BatchDigest = {
      container: "b",
      points: [
        { citations: ["u"], point: "p1" },
        { citations: ["u"], point: "p2" },
      ],
      source: "github",
      summary: "s",
    };
    const reduced = reduceToSourceDigest({ digests: [thin, rich], recordCount: 3, source: "github" });
    expect(reduced.containers.map((c) => c.container)).toEqual(["b", "a"]);
  });

  it("breaks a tie in point count alphabetically by container", () => {
    const a: BatchDigest = {
      container: "b-container",
      points: [{ citations: ["u"], point: "p" }],
      source: "github",
      summary: "s",
    };
    const b: BatchDigest = {
      container: "a-container",
      points: [{ citations: ["u"], point: "p" }],
      source: "github",
      summary: "s",
    };
    const reduced = reduceToSourceDigest({ digests: [a, b], recordCount: 2, source: "github" });
    expect(reduced.containers.map((c) => c.container)).toEqual(["a-container", "b-container"]);
  });
});
