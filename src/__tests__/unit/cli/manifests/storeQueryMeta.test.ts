/**
 * The `store` noun's two question-answering verbs, and the read-shaped base they spread.
 *
 * What these cases hold is the part a spread silently loses: `readMetaFanout` and `citeMeta` both override
 * `diagnostic` and `effect`, so a future edit to {@link readMeta} that looks harmless reaches both. Each
 * effective value is asserted here rather than the override alone, because the override is only half of what
 * a caller actually receives.
 */
import { describe, expect, it } from "vitest";

import { citeMeta, readMeta, readMetaFanout } from "../../../../cli/manifests/storeQueryMeta.js";

describe("readMeta — the read-shaped base", () => {
  it("opens no door, creates no work item, and reports no effect", () => {
    expect(readMeta).toEqual({
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      parseRejectIsIoFree: true,
    });
  });
});

describe("readMetaFanout — `store read`", () => {
  it("writes shard files, so it reports local-state rather than the base's none", () => {
    expect(readMetaFanout.effect).toBe("local-state");
    expect(readMetaFanout.diagnostic).toBe(false);
  });

  it("keeps the base's door and work-item answers, which the override never touches", () => {
    expect(readMetaFanout.doorRouted).toBe(false);
    expect(readMetaFanout.createsWorkItem).toBe(false);
    expect(readMetaFanout.dryParseSafe).toBe(true);
  });

  it("advertises the verb it actually is, with the question positional first", () => {
    expect(readMetaFanout.usage.startsWith("usage: slopweaver store read <question>")).toBe(true);
    expect(readMetaFanout.example).toBe(
      'slopweaver store read "why did the staging pool exhaust" --since 2026-09-01T00:00:00Z',
    );
  });
});

describe("citeMeta — `store cite`", () => {
  it("advertises the verb it actually is, with the question positional first", () => {
    expect(citeMeta.usage.startsWith("usage: slopweaver store cite <question>")).toBe(true);
    expect(citeMeta.example).toBe('slopweaver store cite "auth flow"');
  });

  it("names `--author` and `--thread`, the two flags its usage string once omitted", () => {
    expect(citeMeta.usage).toContain("[--author <a>]");
    expect(citeMeta.usage).toContain("[--thread <native-id>]");
  });

  // A falsifiable absence: the fan-out's usage is asserted to CARRY the flag in the same case, so a rename
  // that drops it everywhere reddens the first line rather than quietly satisfying the second.
  it("offers no `--shard-chars`, which is `store read`'s fan-out flag and not this verb's", () => {
    expect(readMetaFanout.usage).toContain("[--shard-chars <n>]");
    expect(citeMeta.usage.includes("--shard-chars")).toBe(false);
    expect(citeMeta.usage).toContain("[--limit <n>]");
  });

  it("opens no door and creates no work item, the same as every read-shaped verb", () => {
    expect(citeMeta.doorRouted).toBe(false);
    expect(citeMeta.createsWorkItem).toBe(false);
    expect(citeMeta.effect).toBe("local-state");
  });
});
