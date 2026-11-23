import { describe, expect, it } from "vitest";

import { createFetchBudget } from "../../../../corpus/notion/budget.js";

describe("createFetchBudget", () => {
  it("is unbounded when no cap is given — the historical Notion behaviour", () => {
    const budget = createFetchBudget({ maxItems: undefined });
    budget.spend({ items: 10_000 });
    expect(budget.exhausted()).toBe(false);
  });

  it("is exhausted once the cap is reached, and stays exhausted", () => {
    const budget = createFetchBudget({ maxItems: 3 });
    expect(budget.exhausted()).toBe(false);
    budget.spend({ items: 2 });
    expect(budget.exhausted()).toBe(false);
    budget.spend({ items: 1 });
    expect(budget.exhausted()).toBe(true);
    budget.spend({ items: 1 });
    expect(budget.exhausted()).toBe(true);
  });

  it("is exhausted immediately at a zero cap", () => {
    expect(createFetchBudget({ maxItems: 0 }).exhausted()).toBe(true);
  });
});
