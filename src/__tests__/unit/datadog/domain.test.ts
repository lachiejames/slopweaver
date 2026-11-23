import { describe, expect, it } from "vitest";

import {
  assertCountNotKnownSampled,
  assertDomainCanAnswer,
  type CountSamplingEvidence,
  DOMAIN_FOR_MEASURE,
  domainFor,
  INDEXED_SPANS_CAVEAT,
  labelCount,
  SAMPLED_TRAFFIC,
  SAMPLING_CAVEAT,
} from "../../../datadog/domain.js";
import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("DOMAIN_FOR_MEASURE — counts from logs, latency from traces, encoded not printed", () => {
  it("routes a count and an attribution to logs", () => {
    expect(DOMAIN_FOR_MEASURE.count).toBe("logs");
    expect(DOMAIN_FOR_MEASURE.attribution).toBe("logs");
  });

  it("routes latency and shape to spans, where the data actually is", () => {
    expect(DOMAIN_FOR_MEASURE.latency).toBe("spans");
    expect(DOMAIN_FOR_MEASURE.shape).toBe("spans");
  });
});

describe("domainFor", () => {
  it("takes the default when no override is given", () => {
    expect(domainFor({ measure: "count" })).toEqual({ domain: "logs", overridden: false });
  });

  it("reports an override that restates the default as not overridden", () => {
    expect(domainFor({ measure: "count", override: "logs" })).toEqual({ domain: "logs", overridden: false });
  });

  it("honours a real override and says so", () => {
    expect(domainFor({ measure: "count", override: "spans" })).toEqual({ domain: "spans", overridden: true });
  });
});

describe("assertDomainCanAnswer — impossible is different from degraded", () => {
  it("refuses latency from logs, because no caveat would make it honest", () => {
    const error = unwrapErr(assertDomainCanAnswer({ measure: "latency", domain: "logs" }));
    expect(error.code).toBe("LOGS_DOMAIN_UNSUPPORTED");
    const errors = datadogDomainErrorLines({ error });
    expect(errors[0]).toContain("logs carry neither a duration distribution nor a span tree");
    expect(errors[1]).toContain("absence of data rather than a sampled view of it");
  });

  it("refuses shape from logs for the same reason", () => {
    const error = unwrapErr(assertDomainCanAnswer({ measure: "shape", domain: "logs" }));
    expect(error.code).toBe("LOGS_DOMAIN_UNSUPPORTED");
    expect(datadogDomainErrorLines({ error }).length).toBeGreaterThan(0);
  });

  it("allows a count from spans, which is degraded rather than impossible", () => {
    expect(unwrap(assertDomainCanAnswer({ measure: "count", domain: "spans" }))).toBeNull();
  });

  it("allows latency from spans", () => {
    expect(unwrap(assertDomainCanAnswer({ measure: "latency", domain: "spans" }))).toBeNull();
  });
});

describe("assertCountNotKnownSampled — refused before the call, not after", () => {
  it("refuses a spans count with no opt-in, and says why it did not spend the call", () => {
    const error = unwrapErr(assertCountNotKnownSampled({ measure: "count", domain: "spans", allowSampled: false }));
    expect(error.code).toBe("KNOWN_SAMPLED_COUNT_REFUSED");
    const errors = datadogDomainErrorLines({ error });
    expect(errors[0]).toContain("sampled by construction");
    expect(errors[1]).toContain("tightly rate-limited");
    expect(errors[2]).toContain("spans reported 2 where logs reported 7");
  });

  it("allows it once the caller has opted in", () => {
    expect(unwrap(assertCountNotKnownSampled({ measure: "count", domain: "spans", allowSampled: true }))).toBeNull();
  });

  it("does not fire for a latency measure, which is expected to come off sampled traffic", () => {
    expect(unwrap(assertCountNotKnownSampled({ measure: "latency", domain: "spans", allowSampled: false }))).toBeNull();
  });

  it("does not fire on the logs domain", () => {
    expect(unwrap(assertCountNotKnownSampled({ measure: "count", domain: "logs", allowSampled: false }))).toBeNull();
  });
});

describe("labelCount — the response decides the label, not anyone's memory", () => {
  const declared = ({ trafficType }: { trafficType: string | null }): CountSamplingEvidence => ({
    kind: "response",
    trafficType,
  });

  it("labels a count plainly when the reply declared no traffic type, which is every logs reply", () => {
    const label = unwrap(
      labelCount({ measure: "count", evidence: declared({ trafficType: null }), allowSampled: false }),
    );
    expect(label).toEqual({ kind: "count", statedAs: "events", caveats: [] });
  });

  it("refuses a count off a reply that declared itself sampled", () => {
    const error = unwrapErr(
      labelCount({ measure: "count", evidence: declared({ trafficType: SAMPLED_TRAFFIC }), allowSampled: false }),
    );
    expect(error.code).toBe("SAMPLED_RESPONSE_COUNT_REFUSED");
    const errors = datadogDomainErrorLines({ error });
    expect(errors[0]).toContain(`declared 'traffic_type: ${SAMPLED_TRAFFIC}'`);
    expect(errors[1]).toContain("lower bound of unknown tightness");
  });

  it("refuses an attribution off sampled traffic too, since it is a count by another name", () => {
    const error = unwrapErr(
      labelCount({ measure: "attribution", evidence: declared({ trafficType: SAMPLED_TRAFFIC }), allowSampled: false }),
    );
    expect(error.code).toBe("SAMPLED_RESPONSE_COUNT_REFUSED");
    expect(datadogDomainErrorLines({ error }).length).toBeGreaterThan(0);
  });

  it("labels a sampled count as a lower bound once the caller accepts one", () => {
    const label = unwrap(
      labelCount({ measure: "count", evidence: declared({ trafficType: SAMPLED_TRAFFIC }), allowSampled: true }),
    );
    expect(label).toEqual({
      kind: "sampled-count",
      statedAs: "count over sampled traffic — a lower bound, not a total",
      caveats: [SAMPLING_CAVEAT],
    });
  });

  it("carries a sampled latency without refusing it, because a distribution survives sampling", () => {
    const label = unwrap(
      labelCount({ measure: "latency", evidence: declared({ trafficType: SAMPLED_TRAFFIC }), allowSampled: false }),
    );
    expect(label.kind).toBe("sampled-count");
    expect(label.statedAs).toBe("events (sampled traffic)");
  });

  it("treats an unrecognised traffic type as unsampled rather than guessing", () => {
    const label = unwrap(
      labelCount({ measure: "count", evidence: declared({ trafficType: "indexed" }), allowSampled: false }),
    );
    expect(label.kind).toBe("count");
  });
});

describe("labelCount — a domain known to be sampled, for a reply that carries no traffic_type", () => {
  it("labels a spans count sampled with a caveat naming indexed spans, never a declared field", () => {
    const label = unwrap(
      labelCount({ measure: "count", evidence: { kind: "known-domain", domain: "spans" }, allowSampled: true }),
    );
    expect(label).toEqual({
      kind: "sampled-count",
      statedAs: "count over sampled traffic — a lower bound, not a total",
      caveats: [INDEXED_SPANS_CAVEAT],
    });
    expect(INDEXED_SPANS_CAVEAT).not.toContain("declared");
    expect(SAMPLING_CAVEAT).toContain("declared");
  });

  it("refuses a spans count without the opt-in, with the before-the-call refusal", () => {
    const error = unwrapErr(
      labelCount({ measure: "count", evidence: { kind: "known-domain", domain: "spans" }, allowSampled: false }),
    );
    expect(error.code).toBe("KNOWN_SAMPLED_COUNT_REFUSED");
  });

  it("labels a logs-domain count plainly", () => {
    const label = unwrap(
      labelCount({ measure: "count", evidence: { kind: "known-domain", domain: "logs" }, allowSampled: false }),
    );
    expect(label).toEqual({ kind: "count", statedAs: "events", caveats: [] });
  });
});
