import { describe, expect, it } from "vitest";
import { absentAs } from "#lib/absent.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import {
  buildDistilBrief,
  DISTIL_BRIEF_VERSION,
  type DistilBrief,
  parseDistilBrief,
  rebuildBriefBatch,
  renderDistilBrief,
} from "../../../gold/distilBrief.js";
import { type DistilBatch, hashBatch } from "../../../gold/distilGroup.js";
import { DISTIL_RECORD_CHARS } from "../../../gold/recordBody.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseOwnJson } from "../../parseOwnJson.js";

const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "acme/web",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "wire the retriever",
  tsIso: "2026-01-05T00:00:00Z",
  url: "https://example.test/1",
  ...over,
});

const FP = "fingerprint-a";

/** A batch's source: its first record's, or GitHub's for a batch with no records. */
const sourceOf = ({ first }: { first: CorpusRecord | undefined }): CorpusRecord["source"] => {
  if (first === undefined) {
    return "github";
  }
  return first.source;
};

/** A REAL batch, with the hash `hashBatch` would actually compute — not a placeholder. */
const batchOf = ({ records }: { records: readonly CorpusRecord[] }): DistilBatch => {
  const container = absentAs({ value: records[0]?.container, whenAbsent: "acme/web" });
  const source = sourceOf({ first: records[0] });
  return { container, hash: hashBatch({ container, promptVersion: FP, records, source }), records, source };
};

describe("buildDistilBrief + renderDistilBrief", () => {
  it("pins the batch's records in order and carries the exact prompt", () => {
    const records = [rec({ sourceId: "#1" }), rec({ sourceId: "#2" })];
    const batch = batchOf({ records });
    const brief = buildDistilBrief({ batch, promptFingerprint: FP });
    expect(brief.version).toBe(DISTIL_BRIEF_VERSION);
    expect(brief.source).toBe("github");
    expect(brief.container).toBe("acme/web");
    expect(brief.hash).toBe(batch.hash);
    expect(brief.promptFingerprint).toBe(FP);
    expect(brief.refs).toEqual([
      { container: "acme/web", source: "github", sourceId: "#1" },
      { container: "acme/web", source: "github", sourceId: "#2" },
    ]);
    expect(brief.prompt.user).toContain("wire the retriever");
  });

  it("renders the follow-up command naming the given brief path", () => {
    const brief = buildDistilBrief({ batch: batchOf({ records: [rec()] }), promptFingerprint: FP });
    const lines = renderDistilBrief({ brief, briefPath: "/tmp/b.json" });
    expect(lines.some((l) => l.includes("slopweaver distil answer --brief /tmp/b.json"))).toBe(true);
    expect(lines[0]).toContain("acme/web");
    expect(lines[0]).toContain(brief.hash);
  });
});

describe("parseDistilBrief", () => {
  const valid = (): Record<string, unknown> =>
    parseOwnJson<Record<string, unknown>>({
      text: JSON.stringify(buildDistilBrief({ batch: batchOf({ records: [rec()] }), promptFingerprint: FP })),
    });

  it("round-trips a well-formed brief", () => {
    const parsed = unwrap(parseDistilBrief({ input: valid() }));
    expect(parsed.container).toBe("acme/web");
    expect(parsed.refs).toHaveLength(1);
  });

  it("refuses a non-object", () => {
    expect(unwrapErr(parseDistilBrief({ input: "nope" })).code).toBe("DISTIL_BRIEF_NOT_OBJECT");
  });

  it("refuses the wrong version by name, naming the fix", () => {
    const input = { ...valid(), version: 99 };
    expect(unwrapErr(parseDistilBrief({ input })).message).toContain("slopweaver distil brief");
  });

  it("refuses a brief missing promptFingerprint", () => {
    const input = valid();
    delete input["promptFingerprint"];
    const error = unwrapErr(parseDistilBrief({ input }));
    expect(error.code).toBe("DISTIL_BRIEF_INVALID");
    expect(error.message).toBe("the brief is missing source/container/hash/promptFingerprint");
  });

  it("refuses malformed refs (not a list of {source, container, sourceId})", () => {
    const input = { ...valid(), refs: [{ source: "github" }] };
    expect(unwrapErr(parseDistilBrief({ input })).message).toContain("refs");
  });

  it("refuses a prompt missing its user half", () => {
    const input = valid();
    input["prompt"] = { system: "s" };
    expect(unwrapErr(parseDistilBrief({ input })).message).toContain("prompt");
  });
});

describe("rebuildBriefBatch", () => {
  const records = [rec({ sourceId: "#1" }), rec({ container: "acme/api", sourceId: "#9" })];
  const brief: DistilBrief = buildDistilBrief({ batch: batchOf({ records: [records[0]!] }), promptFingerprint: FP });

  it("rebuilds the exact batch when nothing has moved", () => {
    const rebuilt = unwrap(rebuildBriefBatch({ brief, currentFingerprint: FP, records }));
    expect(rebuilt.records).toEqual([records[0]]);
    expect(rebuilt.hash).toBe(brief.hash);
  });

  it("refuses when the distil contract changed since the brief was written", () => {
    const errors = unwrapErr(rebuildBriefBatch({ brief, currentFingerprint: "fingerprint-b", records }));
    expect(errors.message).toContain("distil contract changed");
  });

  it("refuses when a pinned ref no longer resolves — the record vanished", () => {
    const errors = unwrapErr(rebuildBriefBatch({ brief, currentFingerprint: FP, records: [records[1]!] }));
    expect(errors.message).toContain("no longer in the corpus");
  });

  it("refuses when a pinned ref is now ambiguous — two rows share the identity", () => {
    const duped = [records[0]!, { ...records[0]! }];
    const errors = unwrapErr(rebuildBriefBatch({ brief, currentFingerprint: FP, records: duped }));
    expect(errors.message).toContain("matches 2 records");
  });

  it("refuses when the record's TEXT changed — the content hash no longer matches", () => {
    const edited = [{ ...records[0]!, text: "an edited body" }];
    const errors = unwrapErr(rebuildBriefBatch({ brief, currentFingerprint: FP, records: edited }));
    expect(errors.message).toContain("content hash no longer matches");
  });

  it("refuses when the record's REFS changed — same hash, but the rendered prompt moved", () => {
    // The batch hash folds in `sourceId` + the prompted body (title + text, capped) — it does NOT fold in
    // `refs`, so a refs-only edit leaves it unchanged while the prompt (which DOES render `refs: …`)
    // differs. This is the drift check the hash alone cannot catch.
    const reffed = [{ ...records[0]!, refs: ["#99"] }];
    const result = rebuildBriefBatch({ brief, currentFingerprint: FP, records: reffed });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("evidence changed");
  });
});

describe("the clipping the brief now carries", () => {
  /** A record whose body is far past the cap — the 27,158-char PR body, in miniature. */
  const longRecord = (over: Partial<CorpusRecord> = {}): CorpusRecord =>
    rec({ text: "x".repeat(DISTIL_RECORD_CHARS + 5_000), ...over });

  it("records what the cap discarded from THIS batch", () => {
    const batch = batchOf({ records: [longRecord({ sourceId: "#1" }), rec({ sourceId: "#2" })] });
    const brief = buildDistilBrief({ batch, promptFingerprint: FP });

    expect(brief.truncation.measured).toBe(2);
    expect(brief.truncation.truncated).toBe(1);
    expect(brief.truncation.droppedChars).toBeGreaterThan(0);
  });

  it("WARNS above the prompt, because a digest is written from what the prompt shows", () => {
    // A reader who learns afterwards that most of the batch was cut has already written the wrong thing.
    const batch = batchOf({ records: [longRecord()] });
    const lines = renderDistilBrief({
      brief: buildDistilBrief({ batch, promptFingerprint: FP }),
      briefPath: "/b.json",
    });
    const warning = lines.findIndex((line) => line.includes("THIS BATCH IS CLIPPED"));
    const prompt = lines.findIndex((line) => line.includes("--- SYSTEM ---"));

    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(prompt);
  });

  it("tells the session what to DO about it, not just that it happened", () => {
    const batch = batchOf({ records: [longRecord()] });
    const joined = renderDistilBrief({
      brief: buildDistilBrief({ batch, promptFingerprint: FP }),
      briefPath: "/b.json",
    }).join("\n");

    expect(joined).toContain("describes the FIRST part of each long record");
    expect(joined).toContain("rather than asserting what the batch does not contain");
  });

  it("says NOTHING when the batch was whole — a zero line every time trains the eye to skip it", () => {
    const batch = batchOf({ records: [rec()] });
    const joined = renderDistilBrief({
      brief: buildDistilBrief({ batch, promptFingerprint: FP }),
      briefPath: "/b.json",
    }).join("\n");

    expect(joined.includes("THIS BATCH IS CLIPPED")).toBe(false);
  });

  it("round-trips the tally through JSON", () => {
    const batch = batchOf({ records: [longRecord()] });
    const brief = buildDistilBrief({ batch, promptFingerprint: FP });
    const parsed = parseDistilBrief({ input: JSON.parse(JSON.stringify(brief)) });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).truncation).toEqual(brief.truncation);
  });

  it("REFUSES a brief whose tally is missing, rather than reading it as nothing-was-cut", () => {
    // Defaulting to zero would restore the silence this field exists to end, under a field claiming
    // otherwise — worse than the silence, because it now reads as a measurement.
    const batch = batchOf({ records: [longRecord()] });
    const { truncation: _dropped, ...withoutTally } = buildDistilBrief({ batch, promptFingerprint: FP });

    const error = unwrapErr(parseDistilBrief({ input: JSON.parse(JSON.stringify(withoutTally)) }));
    expect(error.code).toBe("DISTIL_BRIEF_INVALID");
    expect(error.message).toBe("the brief's `truncation` tally is missing or malformed");
  });
});
