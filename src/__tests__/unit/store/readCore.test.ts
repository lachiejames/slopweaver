/**
 * The fan-out plan's report, and the one line that keeps an empty answer from lying.
 *
 * `no candidate records` is the sentence a reader is most likely to misread, because it looks exactly
 * like "the org never discussed this". It is not — it is a fact about what has been LOADED, and the plan
 * has to say so in the same breath.
 */
import { describe, expect, it } from "vitest";

import { storeCommandErrorLines } from "../../../cli/commands/store/errors.js";
import {
  fanoutPaths,
  fanoutSlug,
  harvestLines,
  parseStoreCollectArgs,
  planLines,
  shardChars,
  shardPath,
} from "../../../cli/commands/store/readCore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { FanoutPlan, Shard } from "../../../retrieval/fanout.js";

const shard = ({ id, texts }: { id: string; texts: readonly string[] }): Shard => ({
  id,
  records: texts.map((text, at) => ({
    author: null,
    clipped: false,
    container: "slack/C0PROOF",
    id: `C0PROOF:${id}.${String(at)}`,
    source: "slack",
    text,
    title: null,
    tsIso: "2026-09-08T00:00:00.000Z",
    url: "https://example.invalid/x",
  })),
});

describe("fanoutSlug", () => {
  it("carries the question into the directory name, so a listing is readable months later", () => {
    expect(fanoutSlug({ nowIso: "2026-09-10T11:55:54.211Z", question: "Why did the staging pool exhaust?" })).toBe(
      "2026-09-10T11-55-54-211Z-why-did-the-staging-pool-exhaust",
    );
  });

  it("falls back to the instant alone when a question reduces to nothing", () => {
    expect(fanoutSlug({ nowIso: "2026-09-10T11-55-54-211Z", question: "???" })).toBe("2026-09-10T11-55-54-211Z");
  });
});

describe("fanoutPaths", () => {
  it("puts one fan-out under the home, with its plan inside its own directory", () => {
    const paths = fanoutPaths({ home: "/home", slug: "s" });
    expect(paths.dir).toBe("/home/fanout/s");
    expect(paths.plan).toBe("/home/fanout/s/plan.json");
  });

  it("names each shard file by its own id", () => {
    expect(shardPath({ dir: "/home/fanout/s", shard: shard({ id: "s2", texts: [] }) })).toBe("/home/fanout/s/s2.jsonl");
  });
});

describe("shardChars", () => {
  it("counts the record text a reader is actually given", () => {
    expect(shardChars({ shard: shard({ id: "s1", texts: ["abc", "de"] }) })).toBe(5);
  });
});

describe("planLines", () => {
  const plan: FanoutPlan = {
    candidates: 3,
    question: "why did it exhaust",
    shards: [shard({ id: "s1", texts: ["a", "b"] }), shard({ id: "s2", texts: ["c"] })],
  };

  it("prints the full reader instruction for every shard, not once with a placeholder", () => {
    const lines = planLines({ dir: "/d", plan, planPath: "/d/plan.json" });
    const joined = lines.join("\n");
    expect(joined).toContain('"shard": "s1"');
    expect(joined).toContain('"shard": "s2"');
  });

  it("names the collect command a caller runs next, with the plan path already filled in", () => {
    const lines = planLines({ dir: "/d", plan, planPath: "/d/plan.json" });
    expect(lines.some((line) => line.includes("slopweaver store collect --plan /d/plan.json"))).toBe(true);
  });

  it("says an empty result is a fact about the STORE rather than about the world", () => {
    const lines = planLines({
      dir: "/d",
      plan: { candidates: 0, question: "q", shards: [] },
      planPath: "/d/plan.json",
    });
    expect(lines.some((line) => line.includes("a fact about the store, not about the world"))).toBe(true);
  });
});

describe("parseStoreCollectArgs", () => {
  it("takes both paths and says nothing about their contents", () => {
    const parsed = parseStoreCollectArgs({ rest: ["--plan", "p.json", "--replies", "r.json"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).plan).toBe("p.json");
    expect(unwrap(parsed).replies).toBe("r.json");
    expect(unwrap(parsed).json).toBe(false);
  });

  it("refuses without both, because one alone cannot check anything", () => {
    expect(
      storeCommandErrorLines({ error: unwrapErr(parseStoreCollectArgs({ rest: ["--plan", "p.json"] })) }),
    ).toStrictEqual(["--plan and --replies are both required"]);
  });
});

describe("harvestLines", () => {
  it("prints every refusal with its id and its reason, never a bare count", () => {
    const lines = harvestLines({
      harvest: {
        kept: [],
        missingShards: [],
        rejected: [{ id: "C0PROOF:invented", reason: "not-in-shard", shard: "s1" }],
        shardFailures: [],
      },
    });
    expect(lines.some((line) => line === "refused C0PROOF:invented from shard s1: not-in-shard")).toBe(true);
  });

  it("prints a shard-wide refusal even when that shard's reply carried no findings at all", () => {
    const lines = harvestLines({
      harvest: {
        kept: [],
        missingShards: ["s2"],
        rejected: [],
        shardFailures: [{ reason: "shard-file-changed", shard: "s2" }],
      },
    });
    expect(lines[0]).toBe("0 finding(s) survived checking, 1 refused");
    expect(lines.some((line) => line === "refused the whole of shard s2: shard-file-changed")).toBe(true);
  });

  it("says a shard nobody answered for is not a shard that found nothing", () => {
    const lines = harvestLines({ harvest: { kept: [], missingShards: ["s2"], rejected: [], shardFailures: [] } });
    expect(lines.some((line) => line.includes("a reader that never ran is not a reader that found nothing"))).toBe(
      true,
    );
  });

  it("prints a surviving finding with its quote, so the evidence travels with the claim", () => {
    const record = shard({ id: "s1", texts: ["the pool exhausted"] }).records[0]!;
    const lines = harvestLines({
      harvest: {
        kept: [{ finding: { id: record.id, quote: "the pool exhausted", why: "names it" }, record, shard: "s1" }],
        missingShards: [],
        rejected: [],
        shardFailures: [],
      },
    });
    expect(lines.some((line) => line.includes("“the pool exhausted”"))).toBe(true);
    expect(lines[0]).toBe("1 finding(s) survived checking, 0 refused");
  });
});
