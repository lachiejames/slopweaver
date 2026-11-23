import { describe, expect, it } from "vitest";

import {
  capsAreLifted,
  DEFAULT_NOTION_CAPTURE_CAPS,
  liftedCapsAreBounded,
  notionCapsNote,
} from "../../../../corpus/notion/caps.js";

describe("DEFAULT_NOTION_CAPTURE_CAPS", () => {
  it("is exactly what the two constants were before they became liftable", () => {
    expect(DEFAULT_NOTION_CAPTURE_CAPS.maxBlockDepth).toBe(6);
    expect(DEFAULT_NOTION_CAPTURE_CAPS.itemCallBudget).toBe(400);
    expect(DEFAULT_NOTION_CAPTURE_CAPS.itemTimeBudgetMs).toBe(undefined);
  });
});

describe("capsAreLifted", () => {
  it("is false at the shipped defaults", () => {
    expect(capsAreLifted({ caps: DEFAULT_NOTION_CAPTURE_CAPS })).toBe(false);
  });

  it("is true when the depth cap alone is raised", () => {
    expect(capsAreLifted({ caps: { ...DEFAULT_NOTION_CAPTURE_CAPS, maxBlockDepth: 7 } })).toBe(true);
  });

  it("is true when the request budget alone is raised", () => {
    expect(capsAreLifted({ caps: { ...DEFAULT_NOTION_CAPTURE_CAPS, itemCallBudget: 401 } })).toBe(true);
  });

  it("is false when a cap is LOWERED, which needs no time bound to stay schedulable", () => {
    expect(capsAreLifted({ caps: { itemCallBudget: 50, itemTimeBudgetMs: undefined, maxBlockDepth: 2 } })).toBe(false);
  });

  it("is false when only the time bound is set, since that adds a bound rather than removing one", () => {
    expect(capsAreLifted({ caps: { ...DEFAULT_NOTION_CAPTURE_CAPS, itemTimeBudgetMs: 60_000 } })).toBe(false);
  });
});

describe("liftedCapsAreBounded", () => {
  it("holds at the defaults, which have no lifted bound to replace", () => {
    expect(liftedCapsAreBounded({ caps: DEFAULT_NOTION_CAPTURE_CAPS })).toBe(true);
  });

  it("FAILS for a lifted request budget with no time bound — the unschedulable combination", () => {
    expect(
      liftedCapsAreBounded({ caps: { itemCallBudget: 5_000, itemTimeBudgetMs: undefined, maxBlockDepth: 6 } }),
    ).toBe(false);
  });

  it("FAILS for a lifted depth cap with no time bound", () => {
    expect(
      liftedCapsAreBounded({ caps: { itemCallBudget: 400, itemTimeBudgetMs: undefined, maxBlockDepth: 50 } }),
    ).toBe(false);
  });

  it("holds once a lifted run carries a per-item time bound", () => {
    expect(
      liftedCapsAreBounded({ caps: { itemCallBudget: 5_000, itemTimeBudgetMs: 1_800_000, maxBlockDepth: 50 } }),
    ).toBe(true);
  });
});

describe("notionCapsNote", () => {
  it("reports the shipped bounds and says nothing about lifting", () => {
    expect(notionCapsNote({ caps: DEFAULT_NOTION_CAPTURE_CAPS })).toBe(
      "caps: block depth 6, 400 requests per item, no per-item time bound",
    );
  });

  it("names the lift and the time bound when the run raised them", () => {
    expect(notionCapsNote({ caps: { itemCallBudget: 5_000, itemTimeBudgetMs: 1_800_000, maxBlockDepth: 50 } })).toBe(
      "caps: block depth 50, 5000 requests per item, 30.0m per item (LIFTED above the shipped defaults)",
    );
  });
});
