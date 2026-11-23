import { describe, expect, it } from "vitest";

import {
  classifyEnvFacet,
  DEFAULT_PROD_ENV_SHARE_FLOOR,
  DEFAULT_UNTAGGED_SHARE_CEILING,
  tallyEnvBuckets,
} from "../../../datadog/envFacetGuard.js";
import type { CensusBucket } from "../../../datadog/groupedAggregate.js";
import { DEFAULT_PROD_ENVS, isProdEnv, prodEnvFilter } from "../../../datadog/prodEnvFilter.js";

/** An env bucket. A `null` value is how an aggregate encodes the facet being absent. */
function env({ value, count }: { value: string | null; count: number }): CensusBucket {
  return { by: { env: value }, count };
}

describe("isProdEnv — the predicate the filter and the guard share", () => {
  it("accepts both default prod values", () => {
    expect(isProdEnv({ env: "prod" })).toBe(true);
    expect(isProdEnv({ env: "production" })).toBe(true);
  });

  it("is case-insensitive and trims, because it reads a facet value rather than a literal", () => {
    expect(isProdEnv({ env: "  PRODUCTION " })).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isProdEnv({ env: "staging" })).toBe(false);
    expect(isProdEnv({ env: "" })).toBe(false);
    expect(isProdEnv({ env: "preproduction" })).toBe(false);
  });

  it("agrees with the default filter fragment, which is derived from the same list", () => {
    expect(prodEnvFilter()).toBe("env:(prod OR production)");
    expect(DEFAULT_PROD_ENVS.every((value) => isProdEnv({ env: value }))).toBe(true);
  });

  it("accepts a caller-supplied prodEnvs list instead of the default", () => {
    expect(isProdEnv({ env: "live", prodEnvs: ["live"] })).toBe(true);
    expect(isProdEnv({ env: "prod", prodEnvs: ["live"] })).toBe(false);
    expect(prodEnvFilter({ prodEnvs: ["live"] })).toBe("env:(live)");
  });
});

describe("tallyEnvBuckets — untagged is its own tally", () => {
  it("splits prod, non-prod and untagged", () => {
    expect(
      tallyEnvBuckets({
        buckets: [
          env({ value: "production", count: 100 }),
          env({ value: "prod", count: 5 }),
          env({ value: "staging", count: 20 }),
          env({ value: null, count: 40 }),
        ],
      }),
    ).toEqual({ prod: 105, nonProd: 20, untagged: 40 });
  });

  it("counts an empty-string env as untagged rather than as a non-prod value", () => {
    expect(tallyEnvBuckets({ buckets: [env({ value: "", count: 9 })] })).toEqual({ prod: 0, nonProd: 0, untagged: 9 });
  });

  it("reads a differently-named facet when told to", () => {
    const buckets: CensusBucket[] = [{ by: { deployment: "prod" }, count: 3 }];
    expect(tallyEnvBuckets({ buckets, facet: "deployment" })).toEqual({ prod: 3, nonProd: 0, untagged: 0 });
  });

  it("uses a caller-supplied prodEnvs list instead of the default", () => {
    expect(tallyEnvBuckets({ buckets: [env({ value: "live", count: 7 })], prodEnvs: ["live"] })).toEqual({
      prod: 7,
      nonProd: 0,
      untagged: 0,
    });
  });
});

describe("classifyEnvFacet — the guard that stops a staging burst reading as production", () => {
  it("calls a wholly production stream prod", () => {
    const verdict = classifyEnvFacet({ buckets: [env({ value: "production", count: 500 })] });
    expect(verdict.verdict).toBe("prod");
    expect(verdict.prod).toBe(500);
    expect(verdict.reasons[0]).toContain("500 of 500 env-tagged events are production");
  });

  it("calls a staging burst non-prod even though the query carried a prod filter", () => {
    const verdict = classifyEnvFacet({
      buckets: [env({ value: "staging", count: 4000 }), env({ value: "production", count: 10 })],
    });
    expect(verdict.verdict).toBe("non-prod");
    expect(verdict.reasons[1]).toContain("the query carried a prod env filter and matched these anyway");
  });

  it("lets a trickle of genuine prod errors above the floor still count as prod", () => {
    // 15% prod, above the 10% default floor.
    const verdict = classifyEnvFacet({
      buckets: [env({ value: "staging", count: 850 }), env({ value: "production", count: 150 })],
    });
    expect(verdict.verdict).toBe("prod");
  });

  it("uses the TAGGED events as the denominator, not the total", () => {
    // 30 prod of 40 tagged is 75%, comfortably prod — even though prod is only 30 of 70 overall. Untagged is
    // held below the ceiling here on purpose, so this test isolates the denominator rather than tripping the
    // unproven branch as well.
    const verdict = classifyEnvFacet({
      buckets: [
        env({ value: "production", count: 30 }),
        env({ value: "staging", count: 10 }),
        env({ value: null, count: 30 }),
      ],
    });
    expect(verdict.verdict).toBe("prod");
    expect(verdict.untagged).toBe(30);
    expect(verdict.total).toBe(70);
    expect(verdict.reasons[0]).toContain("30 of 40 env-tagged events are production (75.0%)");
  });

  it("grades an overwhelmingly untagged stream unproven, NOT non-prod", () => {
    const verdict = classifyEnvFacet({
      buckets: [env({ value: null, count: 900 }), env({ value: "production", count: 100 })],
    });
    expect(verdict.verdict).toBe("unproven");
    expect(verdict.reasons[0]).toContain("90.0% of the 1000 matched events carry no");
    expect(verdict.reasons[1]).toContain("untagged is NOT non-prod");
  });

  it("grades a wholly untagged stream unproven", () => {
    expect(classifyEnvFacet({ buckets: [env({ value: null, count: 12 })] }).verdict).toBe("unproven");
  });

  it("grades an empty breakdown unproven, because no evidence is not negative evidence", () => {
    const verdict = classifyEnvFacet({ buckets: [] });
    expect(verdict.verdict).toBe("unproven");
    expect(verdict.total).toBe(0);
    expect(verdict.reasons[0]).toContain("came back empty");
  });

  it("holds the two default thresholds where the file says they are", () => {
    expect(DEFAULT_PROD_ENV_SHARE_FLOOR).toBe(0.1);
    expect(DEFAULT_UNTAGGED_SHARE_CEILING).toBe(0.5);
  });

  it("honours a caller-supplied share floor instead of the default", () => {
    // 15% prod would pass the default 10% floor but fails a caller-tightened 20% floor.
    const verdict = classifyEnvFacet({
      buckets: [env({ value: "staging", count: 850 }), env({ value: "production", count: 150 })],
      prodShareFloor: 0.2,
    });
    expect(verdict.verdict).toBe("non-prod");
  });

  it("honours a caller-supplied untagged ceiling instead of the default", () => {
    // 40% untagged would pass the default 50% ceiling but trips a caller-tightened 30% ceiling.
    const verdict = classifyEnvFacet({
      buckets: [env({ value: "production", count: 60 }), env({ value: null, count: 40 })],
      untaggedShareCeiling: 0.3,
    });
    expect(verdict.verdict).toBe("unproven");
  });

  it("honours a caller-supplied prodEnvs list instead of the default", () => {
    const verdict = classifyEnvFacet({ buckets: [env({ value: "live", count: 500 })], prodEnvs: ["live"] });
    expect(verdict.verdict).toBe("prod");
  });
});
