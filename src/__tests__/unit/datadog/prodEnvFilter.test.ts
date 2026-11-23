import { describe, expect, it } from "vitest";

import { DEFAULT_PROD_ENVS, isProdEnv, prodEnvFilter, prodMetricEnvFilter } from "../../../datadog/prodEnvFilter.js";

describe("prodEnvFilter", () => {
  it("derives the Logs Search fragment from the default prod envs", () => {
    expect(prodEnvFilter()).toBe("env:(prod OR production)");
  });

  it("derives the fragment from a caller-supplied prodEnvs list instead", () => {
    expect(prodEnvFilter({ prodEnvs: ["live", "prod-us", "prod-eu"] })).toBe("env:(live OR prod-us OR prod-eu)");
  });
});

describe("prodMetricEnvFilter", () => {
  it("derives the metrics tag-scope fragment from the default prod envs", () => {
    expect(prodMetricEnvFilter()).toBe("(env:prod OR env:production)");
  });

  it("derives the fragment from a caller-supplied prodEnvs list instead", () => {
    expect(prodMetricEnvFilter({ prodEnvs: ["live"] })).toBe("(env:live)");
  });
});

describe("isProdEnv", () => {
  it("accepts every default prod value", () => {
    expect(DEFAULT_PROD_ENVS.every((value) => isProdEnv({ env: value }))).toBe(true);
  });

  it("is case-insensitive and trims", () => {
    expect(isProdEnv({ env: "  Prod  " })).toBe(true);
  });

  it("rejects a value outside the default set", () => {
    expect(isProdEnv({ env: "staging" })).toBe(false);
  });

  it("honours a caller-supplied prodEnvs list, case-insensitively", () => {
    expect(isProdEnv({ env: "LIVE", prodEnvs: ["live"] })).toBe(true);
    expect(isProdEnv({ env: "prod", prodEnvs: ["live"] })).toBe(false);
  });
});
