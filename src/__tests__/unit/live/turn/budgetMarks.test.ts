import { describe, expect, it } from "vitest";

import { budgetMarkState, warnMarkIso } from "../../../../live/turn/budgetMarks.js";

/** The replay fixture's own dispatch: a two-hour lease, answered 3h40m later. */
const DISPATCHED = "2026-09-12T04:24:59.799Z";
const LEASE = "2026-09-12T06:24:48.249Z";
const WARN = "2026-09-12T05:44:52.099Z";
const SPAN_MS = 7_188_450;

describe("warnMarkIso", () => {
  it("sits two thirds of the way from dispatch to the lease, rounded to the millisecond", () => {
    expect(warnMarkIso({ dispatchedIso: DISPATCHED, leaseExpiresAt: LEASE })).toBe(WARN);
  });

  it("refuses an unreadable lease rather than inventing a mark", () => {
    expect(warnMarkIso({ dispatchedIso: DISPATCHED, leaseExpiresAt: "2026-09-12T06,24" })).toBeUndefined();
  });

  it("refuses a lease that does not lie after its dispatch", () => {
    expect(warnMarkIso({ dispatchedIso: LEASE, leaseExpiresAt: DISPATCHED })).toBeUndefined();
  });

  it("refuses a zero span", () => {
    expect(warnMarkIso({ dispatchedIso: LEASE, leaseExpiresAt: LEASE })).toBeUndefined();
  });
});

describe("budgetMarkState", () => {
  it("is before the warn one millisecond short of the mark", () => {
    expect(
      budgetMarkState({ dispatchedIso: DISPATCHED, leaseExpiresAt: LEASE, nowIso: "2026-09-12T05:44:52.098Z" }),
    ).toEqual({
      elapsedMs: 4_792_299,
      kind: "before-warn",
      spanMs: SPAN_MS,
      warnIso: WARN,
    });
  });

  it("is past the warn exactly at the mark", () => {
    expect(budgetMarkState({ dispatchedIso: DISPATCHED, leaseExpiresAt: LEASE, nowIso: WARN }).kind).toBe("past-warn");
  });

  it("stays past the warn far beyond the lease — there is no conclude state here", () => {
    expect(
      budgetMarkState({ dispatchedIso: DISPATCHED, leaseExpiresAt: LEASE, nowIso: "2026-09-12T08:05:55.406Z" }),
    ).toEqual({
      elapsedMs: 13_255_607,
      kind: "past-warn",
      spanMs: SPAN_MS,
      warnIso: WARN,
    });
  });

  it("floors elapsed time at zero for a clock before the dispatch", () => {
    expect(
      budgetMarkState({ dispatchedIso: DISPATCHED, leaseExpiresAt: LEASE, nowIso: "2026-09-12T04:00:00.000Z" }),
    ).toEqual({
      elapsedMs: 0,
      kind: "before-warn",
      spanMs: SPAN_MS,
      warnIso: WARN,
    });
  });

  it("reports invalid for an unreadable clock", () => {
    expect(budgetMarkState({ dispatchedIso: DISPATCHED, leaseExpiresAt: LEASE, nowIso: "later" })).toEqual({
      kind: "invalid",
    });
  });
});
