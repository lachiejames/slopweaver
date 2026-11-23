import { describe, expect, it } from "vitest";

import { brazeDispositionFor, brazeDispositionRuleIds } from "../../../../atlas/braze/dispositions.js";

describe("brazeDispositionFor", () => {
  it("classes the POST that reads named user ids as reachable, not as a mutation", () => {
    const verdict = brazeDispositionFor({ method: "POST", path: "/users/export/ids" });
    expect(verdict.disposition).toBe("reachable");
    expect(verdict.ruleId).toBe("read-post-user-export-ids");
  });

  it("classes the POST that writes user data as excluded", () => {
    const verdict = brazeDispositionFor({ method: "POST", path: "/users/track" });
    expect(verdict.disposition).toBe("excluded");
    expect(verdict.ruleId).toBe("excluded-mutation");
  });

  it("classes a population export as voluminous even though it is also a POST read", () => {
    const verdict = brazeDispositionFor({ method: "POST", path: "/users/export/segment" });
    expect(verdict.disposition).toBe("voluminous");
    expect(verdict.ruleId).toBe("voluminous-user-population-export");
  });

  it("classes an analytics series as voluminous", () => {
    expect(brazeDispositionFor({ method: "GET", path: "/campaigns/data_series" }).disposition).toBe("voluminous");
    expect(brazeDispositionFor({ method: "GET", path: "/purchases/revenue_series" }).disposition).toBe("voluminous");
    expect(brazeDispositionFor({ method: "GET", path: "/canvas/data_summary" }).disposition).toBe("voluminous");
  });

  it("classes a deliverability register as voluminous", () => {
    const verdict = brazeDispositionFor({ method: "GET", path: "/email/hard_bounces" });
    expect(verdict.disposition).toBe("voluminous");
    expect(verdict.ruleId).toBe("voluminous-deliverability-stream");
  });

  it("classes an ordinary listing as reachable configuration", () => {
    const verdict = brazeDispositionFor({ method: "GET", path: "/campaigns/list" });
    expect(verdict.disposition).toBe("reachable");
    expect(verdict.ruleId).toBe("reachable-configuration");
  });

  it("cuts through a family rather than along it — /events/list and /events/data_series differ", () => {
    expect(brazeDispositionFor({ method: "GET", path: "/events/list" }).disposition).toBe("reachable");
    expect(brazeDispositionFor({ method: "GET", path: "/events/data_series" }).disposition).toBe("voluminous");
  });

  it("normalises the host variable before deciding, so a collection URL classes the same as a documented one", () => {
    const fromCollection = brazeDispositionFor({ method: "POST", path: "https://{{instance_url}}/users/export/ids" });
    expect(fromCollection.ruleId).toBe("read-post-user-export-ids");
  });

  it("gives every rule a reason a reader can act on", () => {
    expect(brazeDispositionFor({ method: "GET", path: "/campaigns/list" }).reason.length).toBeGreaterThan(40);
  });
});

describe("brazeDispositionRuleIds", () => {
  it("names every reviewed rule exactly once", () => {
    const ids = brazeDispositionRuleIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "read-post-user-export-ids",
      "voluminous-user-population-export",
      "voluminous-analytics-series",
      "voluminous-deliverability-stream",
      "excluded-mutation",
      "reachable-configuration",
    ]);
  });
});
