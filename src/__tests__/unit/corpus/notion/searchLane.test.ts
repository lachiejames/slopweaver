import { describe, expect, it } from "vitest";
import { createFetchBudget } from "../../../../corpus/notion/budget.js";
import { inWindowSearchHits, scheduleSearchHits } from "../../../../corpus/notion/liveApiPagesLane.js";
import { createNotionCrawlMeter } from "../../../../corpus/notion/meter.js";
import { notionSeenIndexFrom } from "../../../../corpus/notion/seenIndex.js";

const A = "0e2f4a1b-1111-4222-8333-444455556661";
const B = "0e2f4a1b-1111-4222-8333-444455556662";
const C = "0e2f4a1b-1111-4222-8333-444455556663";
const CUTOFF = Date.parse("2026-05-01T00:00:00.000Z");

const hit = ({ id, at }: { id: string; at: string }): Record<string, unknown> => ({
  id,
  last_edited_time: at,
  object: "page",
});

describe("inWindowSearchHits", () => {
  it("keeps every in-window hit in search order", () => {
    const scanned = inWindowSearchHits({
      cutoff: CUTOFF,
      results: [hit({ at: "2026-05-10T00:00:00.000Z", id: A }), hit({ at: "2026-05-05T00:00:00.000Z", id: B })],
    });
    expect(scanned.hits.map((one) => one.id)).toEqual([A, B]);
    expect(scanned.reachedCutoff).toBe(false);
  });

  it("stops at the first hit older than the cutoff, since the search is sorted descending", () => {
    const scanned = inWindowSearchHits({
      cutoff: CUTOFF,
      results: [
        hit({ at: "2026-05-10T00:00:00.000Z", id: A }),
        hit({ at: "2026-04-01T00:00:00.000Z", id: B }),
        hit({ at: "2026-03-01T00:00:00.000Z", id: C }),
      ],
    });
    expect(scanned.hits.map((one) => one.id)).toEqual([A]);
    expect(scanned.reachedCutoff).toBe(true);
  });

  it("skips an id-less hit without treating it as the cutoff", () => {
    const scanned = inWindowSearchHits({
      cutoff: CUTOFF,
      results: [{ object: "page" }, hit({ at: "2026-05-10T00:00:00.000Z", id: A })],
    });
    expect(scanned.hits.map((one) => one.id)).toEqual([A]);
    expect(scanned.reachedCutoff).toBe(false);
  });

  it("keeps everything when there is no cutoff at all (--all)", () => {
    const scanned = inWindowSearchHits({
      cutoff: undefined,
      results: [hit({ at: "2019-01-01T00:00:00.000Z", id: A })],
    });
    expect(scanned.hits.map((one) => one.id)).toEqual([A]);
  });
});

describe("scheduleSearchHits", () => {
  const hits = [A, B, C].map((id) => ({ id, lastEdited: "2026-05-10T00:00:00.000Z", record: hit({ at: "x", id }) }));

  it("drops the hits bronze already holds unchanged, and counts them as skipped", () => {
    const meter = createNotionCrawlMeter();
    const scheduled = scheduleSearchHits({
      budget: createFetchBudget({ maxItems: undefined }),
      hits,
      meter,
      seen: notionSeenIndexFrom({
        coveredSinceIso: "1970-01-01",
        rows: [{ sourceId: `page:${B}`, tsIso: "2026-05-10T00:00:00.000Z" }],
      }),
    });
    expect(scheduled.map((one) => one.id)).toEqual([A, C]);
    expect(meter.read().skippedUnchanged).toBe(1);
  });

  it("spends NO budget on a skipped hit, because it yields no item", () => {
    const budget = createFetchBudget({ maxItems: 2 });
    const scheduled = scheduleSearchHits({
      budget,
      hits,
      meter: createNotionCrawlMeter(),
      seen: notionSeenIndexFrom({
        coveredSinceIso: "1970-01-01",
        rows: [{ sourceId: `page:${A}`, tsIso: "2026-05-10T00:00:00.000Z" }],
      }),
    });
    expect(scheduled.map((one) => one.id)).toEqual([B, C]);
    expect(budget.exhausted()).toBe(true);
  });

  it("reserves the budget UP FRONT, so a concurrent fan-out cannot overshoot --fetch-cap", () => {
    const budget = createFetchBudget({ maxItems: 2 });
    const scheduled = scheduleSearchHits({
      budget,
      hits,
      meter: createNotionCrawlMeter(),
      seen: notionSeenIndexFrom({ coveredSinceIso: "1970-01-01", rows: [] }),
    });
    expect(scheduled.map((one) => one.id)).toEqual([A, B]);
  });

  it("schedules nothing once the budget is already exhausted", () => {
    const budget = createFetchBudget({ maxItems: 1 });
    budget.spend({ items: 1 });
    const scheduled = scheduleSearchHits({
      budget,
      hits,
      meter: createNotionCrawlMeter(),
      seen: notionSeenIndexFrom({ coveredSinceIso: "1970-01-01", rows: [] }),
    });
    expect(scheduled).toEqual([]);
  });
});
