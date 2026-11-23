/**
 * The fan-out reader's two guarantees, both of which are the reason it is trustworthy at all.
 *
 * A cheap parallel reader invites exactly one failure: a fluent report about a record it never opened.
 * Two checks make that unrepresentable rather than unlikely — a finding's id must be in the shard THAT
 * reader was given, and its quote must appear verbatim in that record's own text. Each case below is one
 * of those refusals, plus the shape a real reader returns, so the checks are proved to accept as well as
 * to refuse. A check that cannot fail reports clean.
 */
import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import {
  CLIP_MARKER,
  collectFindings,
  type FanoutPlan,
  MAX_RECORD_CHARS,
  planShards,
  quoteIsInRecord,
  readerInstruction,
  shardRecordFrom,
} from "../../../retrieval/fanout.js";

// register-class: integrity-check-reads-unknown-as-unchanged (docs/recurring-failure-register/bindings.md)

const record = ({ sourceId, text, title }: { sourceId: string; text: string; title?: string }): CorpusRecord => ({
  container: "slack/C0PROOF",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId,
  text,
  tsIso: "2026-09-08T00:00:00.000Z",
  url: `https://example.invalid/${sourceId}`,
  ...(title !== undefined ? { title } : {}),
});

const planOf = ({ records }: { records: readonly CorpusRecord[] }): FanoutPlan => ({
  candidates: records.length,
  question: "why did the staging pool exhaust",
  shards: planShards({ records, shardChars: 60, maxRecords: 1 }),
});

describe("planShards", () => {
  it("closes a shard on the character budget before the record that would exceed it", () => {
    const shards = planShards({
      records: [
        record({ sourceId: "C0PROOF:a", text: "x".repeat(40) }),
        record({ sourceId: "C0PROOF:b", text: "y".repeat(40) }),
        record({ sourceId: "C0PROOF:c", text: "z".repeat(40) }),
      ],
      shardChars: 60,
      maxRecords: 10,
    });
    expect(shards.length).toBe(3);
    expect(shards[0]!.records.length).toBe(1);
    expect(shards[0]!.id).toBe("s1");
    expect(shards[2]!.id).toBe("s3");
  });

  it("closes a shard on the record count even when the characters would fit", () => {
    const shards = planShards({
      records: ["C0PROOF:a", "C0PROOF:b", "C0PROOF:c"].map((sourceId) => record({ sourceId, text: "tiny" })),
      shardChars: 10_000,
      maxRecords: 2,
    });
    expect(shards.length).toBe(2);
    expect(shards[0]!.records.length).toBe(2);
    expect(shards[1]!.records.length).toBe(1);
  });

  it("keeps a single record larger than the whole budget rather than dropping it", () => {
    const shards = planShards({ records: [record({ sourceId: "C0PROOF:a", text: "x".repeat(500) })], shardChars: 60 });
    expect(shards.length).toBe(1);
    expect(shards[0]!.records.length).toBe(1);
  });

  it("marks a clipped record as clipped, so a reader can see it is reading a prefix", () => {
    const entry = shardRecordFrom({
      record: record({ sourceId: "C0PROOF:a", text: "x".repeat(MAX_RECORD_CHARS + 100) }),
    });
    expect(entry.clipped).toBe(true);
    expect(entry.text.endsWith(CLIP_MARKER)).toBe(true);
    expect(entry.text.length).toBe(MAX_RECORD_CHARS + CLIP_MARKER.length);
  });

  it("gives a record's id as its citation token, so nothing maps between reader and answer", () => {
    const entry = shardRecordFrom({ record: record({ sourceId: "C0PROOF:1.2", text: "hello" }) });
    expect(entry.id).toBe("C0PROOF:1.2");
  });
});

describe("quoteIsInRecord", () => {
  it("accepts a quote whose whitespace was re-wrapped", () => {
    const shard = shardRecordFrom({ record: record({ sourceId: "C0PROOF:a", text: "the pool\nexhausted at   noon" }) });
    expect(
      quoteIsInRecord({ finding: { id: "C0PROOF:a", quote: "the pool exhausted at noon", why: "w" }, record: shard }),
    ).toBe(true);
  });

  it("accepts a quote taken from the title, which the shard also carries", () => {
    const shard = shardRecordFrom({
      record: record({ sourceId: "C0PROOF:a", text: "body", title: "staging pool exhausted" }),
    });
    expect(
      quoteIsInRecord({ finding: { id: "C0PROOF:a", quote: "staging pool exhausted", why: "w" }, record: shard }),
    ).toBe(true);
  });

  it("refuses a quote that differs by one word, which is what a paraphrase is", () => {
    const shard = shardRecordFrom({ record: record({ sourceId: "C0PROOF:a", text: "the pool exhausted at noon" }) });
    expect(
      quoteIsInRecord({ finding: { id: "C0PROOF:a", quote: "the pool exhausted at midday", why: "w" }, record: shard }),
    ).toBe(false);
  });

  it("refuses a phrase synthesised ACROSS the title and text boundary, which no reader could have read", () => {
    // Found by a Codex review pass against the first version, which joined the two fields with a space
    // before testing: "charlie delta" is in neither field, and the joined string contains it.
    const shard = shardRecordFrom({
      record: record({ sourceId: "C0PROOF:a", text: "delta echo foxtrot", title: "alpha bravo charlie" }),
    });
    expect(quoteIsInRecord({ finding: { id: "C0PROOF:a", quote: "charlie delta", why: "w" }, record: shard })).toBe(
      false,
    );
  });

  it("still accepts a quote wholly inside the text when the record also has a title", () => {
    const shard = shardRecordFrom({
      record: record({ sourceId: "C0PROOF:a", text: "delta echo foxtrot", title: "alpha bravo charlie" }),
    });
    expect(quoteIsInRecord({ finding: { id: "C0PROOF:a", quote: "delta echo", why: "w" }, record: shard })).toBe(true);
  });

  it("refuses a quote that only matches once case is folded, because folding is how a paraphrase passes", () => {
    const shard = shardRecordFrom({ record: record({ sourceId: "C0PROOF:a", text: "The Pool Exhausted" }) });
    expect(
      quoteIsInRecord({ finding: { id: "C0PROOF:a", quote: "the pool exhausted", why: "w" }, record: shard }),
    ).toBe(false);
  });
});

describe("collectFindings", () => {
  const records = [
    record({ sourceId: "C0PROOF:a", text: "the pool exhausted at noon" }),
    record({ sourceId: "C0PROOF:b", text: "unrelated chatter here" }),
  ];

  it("keeps a finding whose id is in its shard and whose quote is verbatim", () => {
    const plan = planOf({ records });
    const harvest = collectFindings({
      plan,
      replies: [
        { findings: [{ id: "C0PROOF:a", quote: "pool exhausted at noon", why: "names the exhaustion" }], shard: "s1" },
      ],
    });
    expect(harvest.kept.length).toBe(1);
    expect(harvest.kept[0]!.record.id).toBe("C0PROOF:a");
    expect(harvest.kept[0]!.shard).toBe("s1");
    expect(harvest.rejected.length).toBe(0);
  });

  it("refuses an id no shard carries, naming it rather than dropping it", () => {
    const plan = planOf({ records });
    const harvest = collectFindings({
      plan,
      replies: [{ findings: [{ id: "invented", quote: "pool exhausted at noon", why: "made up" }], shard: "s1" }],
    });
    expect(harvest.kept.length).toBe(0);
    expect(harvest.rejected[0]!.id).toBe("invented");
    expect(harvest.rejected[0]!.reason).toBe("not-in-shard");
  });

  it("refuses a real id borrowed from ANOTHER shard, which is a reader reporting on what it was not shown", () => {
    const plan = planOf({ records });
    expect(plan.shards.length).toBe(2);
    const harvest = collectFindings({
      plan,
      replies: [{ findings: [{ id: "C0PROOF:b", quote: "unrelated chatter here", why: "borrowed" }], shard: "s1" }],
    });
    expect(harvest.kept.length).toBe(0);
    expect(harvest.rejected[0]!.reason).toBe("not-in-shard");
  });

  it("refuses a paraphrase, which is the whole point of requiring a quote", () => {
    const plan = planOf({ records });
    const harvest = collectFindings({
      plan,
      replies: [
        { findings: [{ id: "C0PROOF:a", quote: "the pool ran out around lunchtime", why: "paraphrase" }], shard: "s1" },
      ],
    });
    expect(harvest.kept.length).toBe(0);
    expect(harvest.rejected[0]!.reason).toBe("quote-not-in-record");
  });

  it("refuses a reader that claims ANOTHER reader's shard, because the label is a token it cannot forge", () => {
    // Found by a Codex review pass: the reply used to name its own shard by its public id, so two readers
    // could swap labels, each validate against the shard the other was given, and smuggle in records
    // neither had read. Both were kept, both shards read as answered, and the verb exited zero.
    const plan = planOf({ records });
    const tokened: FanoutPlan = {
      ...plan,
      shards: plan.shards.map((shard) => ({ ...shard, token: `tok-${shard.id}` })),
    };
    expect(tokened.shards.length).toBe(2);
    const harvest = collectFindings({
      plan: tokened,
      // The reader given s1 quotes s2's record, and labels itself with s1's own token.
      replies: [{ findings: [{ id: "C0PROOF:b", quote: "unrelated chatter here", why: "swapped" }], shard: "tok-s1" }],
    });
    expect(harvest.kept.length).toBe(0);
    expect(harvest.rejected[0]!.reason).toBe("not-in-shard");
    expect(harvest.missingShards).toStrictEqual(["s2"]);
  });

  it("routes a reply by its TOKEN rather than by the readable shard name", () => {
    const plan = planOf({ records });
    const tokened: FanoutPlan = {
      ...plan,
      shards: plan.shards.map((shard) => ({ ...shard, token: `tok-${shard.id}` })),
    };
    const harvest = collectFindings({
      plan: tokened,
      replies: [{ findings: [{ id: "C0PROOF:a", quote: "pool exhausted at noon", why: "its own" }], shard: "tok-s1" }],
    });
    expect(harvest.kept.length).toBe(1);
    expect(harvest.kept[0]!.shard).toBe("s1");
  });

  it("refuses a reply carrying a shard name where the plan minted tokens, since the name is not the key", () => {
    const plan = planOf({ records });
    const tokened: FanoutPlan = {
      ...plan,
      shards: plan.shards.map((shard) => ({ ...shard, token: `tok-${shard.id}` })),
    };
    const harvest = collectFindings({
      plan: tokened,
      replies: [{ findings: [{ id: "C0PROOF:a", quote: "pool exhausted at noon", why: "bare name" }], shard: "s1" }],
    });
    expect(harvest.kept.length).toBe(0);
    expect(harvest.shardFailures[0]!.reason).toBe("unknown-shard");
  });

  it("refuses every finding from a shard nobody planned", () => {
    const plan = planOf({ records });
    const harvest = collectFindings({
      plan,
      replies: [
        { findings: [{ id: "C0PROOF:a", quote: "pool exhausted at noon", why: "wrong shard name" }], shard: "s99" },
      ],
    });
    expect(harvest.shardFailures[0]!.reason).toBe("unknown-shard");
  });

  it("reports a tampered shard whose reply carried NOTHING, rather than counting it as answered", () => {
    // Found by a Codex review pass: an integrity failure used to be recorded once per FINDING, so an empty
    // `findings` array produced no refusal, the shard was already marked answered, and a sibling shard's
    // valid finding carried the whole run to exit zero.
    const plan = planOf({ records });
    const withDigest: FanoutPlan = {
      ...plan,
      shards: plan.shards.map((shard) => ({ ...shard, digest: `planned-${shard.id}` })),
    };
    const harvest = collectFindings({
      digests: new Map([
        ["s1", "planned-s1"],
        ["s2", "moved"],
      ]),
      plan: withDigest,
      replies: [
        { findings: [{ id: "C0PROOF:a", quote: "pool exhausted at noon", why: "genuine" }], shard: "s1" },
        { findings: [], shard: "s2" },
      ],
    });
    expect(harvest.kept.length).toBe(1);
    expect(harvest.rejected.length).toBe(0);
    expect(harvest.shardFailures).toStrictEqual([{ reason: "shard-file-changed", shard: "s2" }]);
    expect(harvest.missingShards).toStrictEqual(["s2"]);
  });

  it("refuses every finding from a shard whose FILE has changed since the plan was written", () => {
    const plan = planOf({ records });
    const withDigest: FanoutPlan = {
      ...plan,
      shards: plan.shards.map((shard) => ({ ...shard, digest: "planned-digest" })),
    };
    const harvest = collectFindings({
      digests: new Map([["s1", "a-different-digest"]]),
      plan: withDigest,
      replies: [
        { findings: [{ id: "C0PROOF:a", quote: "pool exhausted at noon", why: "read a moved file" }], shard: "s1" },
      ],
    });
    expect(harvest.kept.length).toBe(0);
    expect(harvest.shardFailures).toStrictEqual([{ reason: "shard-file-changed", shard: "s1" }]);
  });

  it("refuses every finding from a shard the caller LOOKED at and could not hash, rather than passing it", () => {
    // Found by a Codex review pass against the earlier version, which read a missing current digest as
    // "unchanged": a shard that had been chmod-000'd after the readers ran passed every check and exited
    // zero, with the plan's own inline copy standing in for a file nobody could read.
    const plan = planOf({ records });
    const withDigest: FanoutPlan = {
      ...plan,
      shards: plan.shards.map((shard) => ({ ...shard, digest: "planned-digest" })),
    };
    const harvest = collectFindings({
      digests: new Map([["s1", null]]),
      plan: withDigest,
      replies: [
        { findings: [{ id: "C0PROOF:a", quote: "pool exhausted at noon", why: "unreadable file" }], shard: "s1" },
      ],
    });
    expect(harvest.kept.length).toBe(0);
    expect(harvest.shardFailures).toStrictEqual([{ reason: "shard-file-unreadable", shard: "s1" }]);
  });

  it("checks nothing when the plan recorded no digest, so an in-memory fan-out is not refused", () => {
    const plan = planOf({ records });
    const harvest = collectFindings({
      digests: new Map([["s1", null]]),
      plan,
      replies: [
        { findings: [{ id: "C0PROOF:a", quote: "pool exhausted at noon", why: "no digest planned" }], shard: "s1" },
      ],
    });
    expect(harvest.kept.length).toBe(1);
    expect(harvest.rejected.length).toBe(0);
  });

  it("names a shard nobody replied for, because a reader that never ran found nothing to report", () => {
    const plan = planOf({ records });
    const harvest = collectFindings({ plan, replies: [{ findings: [], shard: "s1" }] });
    expect(harvest.missingShards).toStrictEqual(["s2"]);
  });
});

describe("readerInstruction", () => {
  it("names the shard, the file and the question a reader is being given", () => {
    const plan = planOf({ records: [record({ sourceId: "C0PROOF:a", text: "hello" })] });
    const line = readerInstruction({ path: "/tmp/s1.jsonl", question: plan.question, shard: plan.shards[0]! });
    expect(line).toContain("/tmp/s1.jsonl");
    expect(line).toContain("why did the staging pool exhaust");
    expect(line).toContain('"shard": "s1"');
    expect(line).toContain("must appear VERBATIM");
  });
});
