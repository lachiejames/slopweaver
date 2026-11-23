import { describe, expect, it } from "vitest";

import { DatadogDomainErrors, datadogDomainErrorLines } from "../../../datadog/domainErrors.js";

describe("DatadogDomainErrors", () => {
  it("prints an empty window as its one sentence", () => {
    const error = DatadogDomainErrors.windowEmpty({ fromMs: 2000, toMs: 1000 });
    expect(error).toEqual({
      code: "WINDOW_EMPTY",
      fromMs: 2000,
      message: "the window is empty: --from resolved to 2000 and --to to 1000. A window must start before it ends",
      toMs: 1000,
    });
    expect(datadogDomainErrorLines({ error })).toEqual([
      "the window is empty: --from resolved to 2000 and --to to 1000. A window must start before it ends",
    ]);
  });

  it("prints invalid window bounds one reason per line", () => {
    const error = DatadogDomainErrors.windowBoundsInvalid({ reasons: ["bad --from", "bad --to"] });
    expect(error.code).toBe("WINDOW_BOUNDS_INVALID");
    expect(error.message).toBe("bad --from; bad --to");
    expect(datadogDomainErrorLines({ error })).toEqual(["bad --from", "bad --to"]);
  });

  it("refuses a logs measure logs cannot answer, in two lines", () => {
    const error = DatadogDomainErrors.logsDomainUnsupported({ measure: "p95 latency" });
    expect(error.code).toBe("LOGS_DOMAIN_UNSUPPORTED");
    expect(datadogDomainErrorLines({ error })).toEqual([
      "the logs domain cannot answer 'p95 latency': logs carry neither a duration distribution nor a span tree",
      "this is an absence of data rather than a sampled view of it, so no caveat would make the answer honest — route it to spans",
    ]);
  });

  it("refuses a known-sampled count before the call, naming the traffic type", () => {
    const error = DatadogDomainErrors.knownSampledCountRefused({ measure: "error count", trafficType: "sampled" });
    expect(error.code).toBe("KNOWN_SAMPLED_COUNT_REFUSED");
    const lines = datadogDomainErrorLines({ error });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      "a error count from the spans domain is sampled by construction: every spans aggregate declares 'traffic_type: sampled'",
    );
    expect(lines[3]).toBe(
      "route the error count to the logs domain, which is unsampled here; or pass the explicit opt-in to have it reported as a sampled error count",
    );
  });

  it("refuses a count a response declared sampled", () => {
    const error = DatadogDomainErrors.sampledResponseCountRefused({ measure: "hit count", trafficType: "sampled" });
    expect(error.code).toBe("SAMPLED_RESPONSE_COUNT_REFUSED");
    const lines = datadogDomainErrorLines({ error });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("refusing to report a hit count taken from a response that declared 'traffic_type: sampled'");
  });
});
