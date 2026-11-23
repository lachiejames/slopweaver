/**
 * The pinned request contracts, and the two things that make one worth having.
 *
 * A contract naming an operation the registry does not admit applies to nothing while reading as coverage,
 * and the provider takes exactly one `targets` value per graph request — so both are asserted here rather
 * than left to the sync to discover against a live tenancy.
 */
import { describe, expect, it } from "vitest";

import { pageQuery } from "../../../../atlas/jumpcloud/paging.js";
import {
  JUMPCLOUD_REQUEST_CONTRACTS,
  JUMPCLOUD_RISK_WINDOW_DAYS,
  jumpcloudContractFingerprint,
  jumpcloudQueryVariants,
  jumpcloudRequiredQuery,
  uncontractedOperationNames,
} from "../../../../atlas/jumpcloud/requestContracts.js";
import { resumeKey } from "../../../../atlas/jumpcloud/resume.js";

const NOW = "2026-09-15T00:00:00.000Z";

describe("every pinned contract names an operation the closed registry admits", () => {
  it("holds contracts at all, so the emptiness of the next assertion cannot be what passes it", () => {
    expect(Object.keys(JUMPCLOUD_REQUEST_CONTRACTS).length).toBeGreaterThan(0);
  });

  it("names no operation the registry does not hold", () => {
    expect(uncontractedOperationNames()).toEqual([]);
  });

  it("carries the provider's own refusal on every row, so a reader can check the measurement", () => {
    const unmeasured = Object.values(JUMPCLOUD_REQUEST_CONTRACTS)
      .filter((contract) => contract.measuredFrom.trim() === "")
      .map((contract) => contract.operation)
      .toSorted();

    expect(unmeasured).toEqual([]);
  });
});

describe("a graph operation's targets", () => {
  it("lists every allowable target, so no association family is silently omitted", () => {
    const query = jumpcloudRequiredQuery({ now: NOW, operation: "v2-graph-system-associations-list" });

    expect(query["targets"]).toEqual(["command", "policy", "policy_group", "user", "user_group"]);
  });

  it("differs per family, because the provider's allowable set does", () => {
    const group = jumpcloudRequiredQuery({ now: NOW, operation: "v2-graph-system-group-associations-list" });

    expect(group["targets"]).toEqual(["command", "policy", "policy_group", "radius_server", "user", "user_group"]);
  });

  it("is empty for an operation with no pinned contract, so an uncontracted call is unchanged", () => {
    expect(jumpcloudRequiredQuery({ now: NOW, operation: "v1-systems-list" })).toEqual({});
  });
});

describe("a windowed operation", () => {
  it("derives both instants from the run's own clock", () => {
    const query = jumpcloudRequiredQuery({ now: NOW, operation: "v2-risk-stats-service-get-stats" });

    expect(query["end_time"]).toBe("2026-09-15T00:00:00.000Z");
    expect(query["start_time"]).toBe("2026-08-16T00:00:00.000Z");
  });

  it("spans exactly the pinned number of days", () => {
    const query = jumpcloudRequiredQuery({ now: NOW, operation: "v2-risk-stats-service-get-login-type-distribution" });
    const start = Date.parse(String(query["start_time"]));
    const end = Date.parse(String(query["end_time"]));

    expect((end - start) / (24 * 60 * 60 * 1000)).toBe(JUMPCLOUD_RISK_WINDOW_DAYS);
  });

  it("sends the bare contract rather than an invented interval when the clock is unparseable", () => {
    expect(jumpcloudRequiredQuery({ now: "not-an-instant", operation: "v2-risk-stats-service-get-stats" })).toEqual({});
  });
});

describe("the two fixed-value contracts", () => {
  it("asks application usage for a day count, which the provider requires", () => {
    expect(jumpcloudRequiredQuery({ now: NOW, operation: "v2-get-application-usage" })).toEqual({ day_count: "30" });
  });
});

describe("a contract cannot collide with the paging parameters it is merged beside", () => {
  it("names none of the keys a page query owns, which the merge would otherwise let paging overwrite", () => {
    // `syncRead.ts` spreads the contract first and the paging half second, so a shared key would be the
    // paging value SILENTLY — the contract would be dropped with nothing saying so. The names are disjoint
    // today and this is what keeps them that way; a future contract needing one of these has to change the
    // merge rather than discover it against a live tenancy.
    const pagingKeys = (["limit-skip", "limit-offset", "token", "limit-only"] as const).flatMap((pagination) =>
      Object.keys(pageQuery({ alreadyRead: 0, cursor: "c", pagination })),
    );
    const collisions = Object.values(JUMPCLOUD_REQUEST_CONTRACTS)
      .flatMap((contract) => Object.keys(contract.query).map((key) => `${contract.operation}:${key}`))
      .filter((entry) => pagingKeys.includes(entry.split(":")[1]!))
      .toSorted();

    expect(pagingKeys.length).toBeGreaterThan(0);
    expect(collisions).toEqual([]);
  });
});

describe("the contract fingerprint, which is what stops the journal replaying a fixed 400", () => {
  it("is absent for an uncontracted operation, so its journal key is unchanged byte for byte", () => {
    expect(jumpcloudContractFingerprint({ operation: "v1-systems-list" })).toBe(null);
    expect(resumeKey({ endpoint: "/api/systems", surface: "v1-systems-list" })).toBe("v1-systems-list|/api/systems");
  });

  it("is part of a contracted operation's journal key, so the old settled 400 is not replayed", () => {
    const key = resumeKey({
      endpoint: "/api/v2/systems/s1/associations",
      surface: "v2-graph-system-associations-list",
    });

    expect(key).toBe(
      `v2-graph-system-associations-list|/api/v2/systems/s1/associations|${String(
        jumpcloudContractFingerprint({ operation: "v2-graph-system-associations-list" }),
      )}`,
    );
  });

  it("differs between two families whose contracts differ, so one cannot mask the other", () => {
    const system = jumpcloudContractFingerprint({ operation: "v2-graph-system-associations-list" });
    const group = jumpcloudContractFingerprint({ operation: "v2-graph-system-group-associations-list" });

    expect(system).not.toBe(group);
  });

  it("does not move with the clock, so a windowed operation keeps one key across runs", () => {
    const first = jumpcloudContractFingerprint({ operation: "v2-risk-stats-service-get-stats" });
    const second = jumpcloudContractFingerprint({ operation: "v2-risk-stats-service-get-stats" });

    expect(first).toBe(second);
  });
});

describe("the query variants an operation is read with", () => {
  it("splits a graph operation into one query per target, because the provider takes exactly one", () => {
    const variants = jumpcloudQueryVariants({ now: NOW, operation: "v2-graph-system-associations-list" });

    expect(variants).toEqual([
      { targets: "command" },
      { targets: "policy" },
      { targets: "policy_group" },
      { targets: "user" },
      { targets: "user_group" },
    ]);
  });

  it("reads an uncontracted operation exactly once, with no query", () => {
    expect(jumpcloudQueryVariants({ now: NOW, operation: "v1-systems-list" })).toEqual([{}]);
  });

  it("reads a fixed-value contract exactly once, with its whole query", () => {
    expect(jumpcloudQueryVariants({ now: NOW, operation: "v2-get-application-usage" })).toEqual([{ day_count: "30" }]);
  });
});
