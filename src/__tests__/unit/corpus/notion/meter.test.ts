import { describe, expect, it } from "vitest";
import { DEFAULT_NOTION_CAPTURE_CAPS } from "../../../../corpus/notion/caps.js";
import { createNotionItemBudget } from "../../../../corpus/notion/itemCrawl.js";
import { createNotionCrawlMeter, notionThroughputNote } from "../../../../corpus/notion/meter.js";

describe("createNotionCrawlMeter", () => {
  it("starts at zero", () => {
    expect(createNotionCrawlMeter().read()).toEqual({ calls: 0, skippedUnchanged: 0 });
  });

  it("counts calls and skipped items independently", () => {
    const meter = createNotionCrawlMeter();
    meter.countCall();
    meter.countCall();
    meter.countSkippedUnchanged({ id: "a" });
    meter.countSkippedUnchanged({ id: "b" });
    expect(meter.read()).toEqual({ calls: 2, skippedUnchanged: 2 });
  });

  it("counts an id skipped twice once, since both lanes meet the same row", () => {
    const meter = createNotionCrawlMeter();
    meter.countSkippedUnchanged({ id: "a" });
    meter.countSkippedUnchanged({ id: "a" });
    expect(meter.read().skippedUnchanged).toBe(1);
  });

  it("tells a later lane which ids an earlier one already passed over", () => {
    const meter = createNotionCrawlMeter();
    meter.countSkippedUnchanged({ id: "a" });
    expect(meter.wasSkippedUnchanged({ id: "a" })).toBe(true);
    expect(meter.wasSkippedUnchanged({ id: "b" })).toBe(false);
  });

  it("hands out a snapshot that a later count does not mutate", () => {
    const meter = createNotionCrawlMeter();
    meter.countCall();
    const snapshot = meter.read();
    meter.countCall();
    expect(snapshot.calls).toBe(1);
  });
});

describe("notionThroughputNote", () => {
  it("reports the ACHIEVED rate against the cap, which is the whole point of measuring", () => {
    expect(
      notionThroughputNote({
        elapsedMs: 100_000,
        ratePerSec: 3,
        totals: { calls: 120, skippedUnchanged: 40 },
      }),
    ).toBe(
      "throughput: 120 request(s) in 100s — 1.20 req/s achieved of 3 req/s cap (40%), 40 item(s) skipped as unchanged in bronze",
    );
  });

  it("reports a saturated crawl at 100% of the cap", () => {
    expect(notionThroughputNote({ elapsedMs: 10_000, ratePerSec: 3, totals: { calls: 30, skippedUnchanged: 0 } })).toBe(
      "throughput: 30 request(s) in 10s — 3.00 req/s achieved of 3 req/s cap (100%), 0 item(s) skipped as unchanged in bronze",
    );
  });

  it("does not divide by zero on a crawl that issued nothing at all", () => {
    expect(notionThroughputNote({ elapsedMs: 0, ratePerSec: 3, totals: { calls: 0, skippedUnchanged: 0 } })).toBe(
      "throughput: 0 request(s) in 0s — 0.00 req/s achieved of 3 req/s cap (0%), 0 item(s) skipped as unchanged in bronze",
    );
  });
});

describe("createNotionItemBudget", () => {
  it("starts unspent", () => {
    const budget = createNotionItemBudget({ maxCalls: 3 });
    expect(budget.exhausted()).toBe(false);
    expect(budget.spent()).toBe(0);
    expect(budget.stoppedBy()).toBe(undefined);
  });

  it("is exhausted exactly at the allowance, not one call later", () => {
    const budget = createNotionItemBudget({ maxCalls: 2 });
    budget.spendCall();
    expect(budget.exhausted()).toBe(false);
    budget.spendCall();
    expect(budget.exhausted()).toBe(true);
    expect(budget.spent()).toBe(2);
    expect(budget.stoppedBy()).toBe("calls");
  });

  it("defaults to the measured equivalent of the old five-minute wall-clock bound", () => {
    const budget = createNotionItemBudget();
    expect(budget.exhausted()).toBe(false);
    expect(DEFAULT_NOTION_CAPTURE_CAPS.itemCallBudget).toBe(400);
  });

  it("has no time bound at all by default, however long the item runs", () => {
    let now = 0;
    const budget = createNotionItemBudget({ maxCalls: 10, nowMs: () => now });
    now = 86_400_000;
    expect(budget.exhausted()).toBe(false);
    expect(budget.stoppedBy()).toBe(undefined);
  });

  it("stops on the TIME bound when the item has spent barely any of its requests", () => {
    let now = 1_000;
    const budget = createNotionItemBudget({ maxCalls: 100_000, maxMs: 60_000, nowMs: () => now });
    budget.spendCall();
    now = 60_999;
    expect(budget.exhausted()).toBe(false);
    now = 61_000;
    expect(budget.exhausted()).toBe(true);
    expect(budget.stoppedBy()).toBe("time");
    expect(budget.spent()).toBe(1);
  });

  it("reports the REQUEST bound when both are spent, since that is the one a lifted budget removes", () => {
    let now = 0;
    const budget = createNotionItemBudget({ maxCalls: 1, maxMs: 10, nowMs: () => now });
    budget.spendCall();
    now = 500;
    expect(budget.stoppedBy()).toBe("calls");
  });
});
