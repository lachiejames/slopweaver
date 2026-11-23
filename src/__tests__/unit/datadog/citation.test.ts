/**
 * Every Datadog host in this file reads a synthetic site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { type CitationExpectation, validateCitation } from "../../../datadog/citation.js";
import { type DatadogCitationError, datadogCitationErrorLines } from "../../../datadog/citationErrors.js";
import { type DdLinkDomain, ddConsoleLink } from "../../../datadog/ddLink.js";
import { prodEnvFilter } from "../../../datadog/prodEnvFilter.js";
import { type Result, unwrap, unwrapErr } from "../../../lib/result.js";

const CONSOLE_HOST = "us3.datadoghq.com";
const WINDOW = { fromMs: 1_785_844_800_000, toMs: 1_785_848_400_000 };

/** The lines a refused citation prints, after asserting it was refused as `code` rather than merely refused. */
function refusalLines({
  result,
  code = "CITATION_REFUSED",
}: {
  result: Result<URL, DatadogCitationError>;
  code?: DatadogCitationError["code"];
}): readonly string[] {
  const error = unwrapErr(result);
  expect(error.code).toBe(code);
  return datadogCitationErrorLines({ error });
}

/** The default expectation: a logs citation for a claim that was not prod-scoped or a phrase match. */
function expectation({
  requireProdEnv = false,
  domain = "logs",
  allowPhraseMatch = false,
}: { requireProdEnv?: boolean; domain?: DdLinkDomain; allowPhraseMatch?: boolean } = {}): CitationExpectation {
  return { allowPhraseMatch, consoleHost: CONSOLE_HOST, domain, requireProdEnv, label: "citation" };
}

describe("validateCitation — a link our own builder produced must pass", () => {
  it("accepts a logs link from ddConsoleLink, which a naive validator would have rejected", () => {
    // The regression that matters most: a validator demanding live=false AND paused=true on every link would
    // reject a correctly frozen logs link — which sets live=false and no paused at all.
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: "service:example-api status:error",
      window: WINDOW,
      extraParams: null,
    });
    expect(unwrap(validateCitation({ url, expectation: expectation() })).host).toBe(CONSOLE_HOST);
  });

  it("accepts a traces link, which freezes with the other param set entirely", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "traces",
      query: "service:example-api",
      window: WINDOW,
      extraParams: null,
    });
    expect(unwrap(validateCitation({ url, expectation: expectation({ domain: "traces" }) })).pathname).toBe(
      "/apm/traces",
    );
  });

  it("rejects a logs link judged against the traces freeze params, so the domains are not interchangeable", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: "service:example-api",
      window: WINDOW,
      extraParams: null,
    });
    expect(
      refusalLines({ result: validateCitation({ url, expectation: expectation({ domain: "traces" }) }) }).length,
    ).toBeGreaterThan(0);
  });
});

describe("validateCitation — the target", () => {
  it("rejects a URL that does not parse", () => {
    expect(
      refusalLines({
        code: "CITATION_URL_INVALID",
        result: validateCitation({ url: "not a url", expectation: expectation() }),
      })[0],
    ).toContain("not a valid URL");
  });

  it("rejects another Datadog site, which answers with silence rather than an error", () => {
    const url = ddConsoleLink({
      consoleHost: "ap1.datadoghq.com",
      domain: "logs",
      query: "service:example-api",
      window: WINDOW,
      extraParams: null,
    });
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toContain(
      `must point at ${CONSOLE_HOST}`,
    );
  });

  it("rejects a visibility-scoped deep link", () => {
    const url = `https://${CONSOLE_HOST}/error-tracking/issues/abc123?query=service%3Aexample-api&from_ts=${String(WINDOW.fromMs)}&to_ts=${String(WINDOW.toMs)}&live=false`;
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toContain(
      "renders empty for most viewers",
    );
  });
});

describe("validateCitation — the query", () => {
  it("rejects a citation with no query at all", () => {
    const url = `https://${CONSOLE_HOST}/logs?from_ts=${String(WINDOW.fromMs)}&to_ts=${String(WINDOW.toMs)}&live=false`;
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toContain(
      "carries no query",
    );
  });

  it("rejects a quoted free-text term", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: '"does not have an email address"',
      window: WINDOW,
      extraParams: null,
    });
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toContain(
      "quoted free-text term",
    );
  });

  it("accepts the same quoted term when the caller declared the claim IS a phrase match", () => {
    // The alert-probe case: a check watching a throw site's own log line has no facet to query instead, so
    // the phrase IS the evidence. Conditional on having asked — `expectation()` above still rejects it.
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: '"does not have an email address"',
      window: WINDOW,
      extraParams: null,
    });
    expect(unwrap(validateCitation({ url, expectation: expectation({ allowPhraseMatch: true }) })).pathname).toBe(
      "/logs",
    );
  });

  it("still rejects a spaced wildcard when a phrase match was allowed — the two rules are independent", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: '@user.name:*two words* "a phrase"',
      window: WINDOW,
      extraParams: null,
    });
    expect(
      refusalLines({ result: validateCitation({ url, expectation: expectation({ allowPhraseMatch: true }) }) })[0],
    ).toContain("wildcard containing spaces");
  });

  it("rejects a wildcard containing spaces, which renders zero rows in the console", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: "@err.message:*does not have an email address*",
      window: WINDOW,
      extraParams: null,
    });
    const errors = refusalLines({ result: validateCitation({ url, expectation: expectation() }) });
    expect(errors[0]).toContain("wildcard containing spaces");
    expect(errors[0]).toContain("renders 0 rows in the console");
  });

  it("does not mistake two adjacent single-word wildcards for one spanning wildcard", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: "@a:*alpha* @b:*beta*",
      window: WINDOW,
      extraParams: null,
    });
    expect(unwrap(validateCitation({ url, expectation: expectation() })).pathname).toBe("/logs");
  });

  it("accepts a bare reserved facet, since an @-prefixed one silently matches nothing", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: "service:example-api status:error",
      window: WINDOW,
      extraParams: null,
    });
    expect(unwrap(validateCitation({ url, expectation: expectation() })).pathname).toBe("/logs");
  });
});

describe("validateCitation — the env gate is conditional on having asked", () => {
  it("does not require an env filter by default, because a large share of logs carry no env tag", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: "service:example-api",
      window: WINDOW,
      extraParams: null,
    });
    expect(unwrap(validateCitation({ url, expectation: expectation() })).pathname).toBe("/logs");
  });

  it("requires it when the claim was prod-scoped", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: "service:example-api",
      window: WINDOW,
      extraParams: null,
    });
    expect(
      refusalLines({ result: validateCitation({ url, expectation: expectation({ requireProdEnv: true }) }) })[0],
    ).toContain(prodEnvFilter());
  });

  it("accepts a prod-scoped claim whose query carries the derived filter", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: `service:example-api ${prodEnvFilter()}`,
      window: WINDOW,
      extraParams: null,
    });
    expect(unwrap(validateCitation({ url, expectation: expectation({ requireProdEnv: true }) })).pathname).toBe(
      "/logs",
    );
  });

  it("checks a caller-supplied prodEnvs list instead of the default", () => {
    const url = ddConsoleLink({
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      query: "service:example-api env:(live)",
      window: WINDOW,
      extraParams: null,
    });
    const expectationWithCustomEnvs: CitationExpectation = {
      allowPhraseMatch: false,
      consoleHost: CONSOLE_HOST,
      domain: "logs",
      requireProdEnv: true,
      label: "citation",
      prodEnvs: ["live"],
    };
    expect(unwrap(validateCitation({ url, expectation: expectationWithCustomEnvs })).pathname).toBe("/logs");
  });
});

describe("validateCitation — the window", () => {
  it("rejects an absent window, which opens live at now", () => {
    const url = `https://${CONSOLE_HOST}/logs?query=service%3Aexample-api&live=false`;
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toContain(
      "epoch milliseconds",
    );
  });

  it("rejects a non-integer bound rather than coercing a typo to the epoch", () => {
    const url = `https://${CONSOLE_HOST}/logs?query=service%3Aexample-api&from_ts=8x&to_ts=${String(WINDOW.toMs)}&live=false`;
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toContain(
      "absolute window",
    );
  });

  it("rejects an inverted window", () => {
    const url = `https://${CONSOLE_HOST}/logs?query=service%3Aexample-api&from_ts=${String(WINDOW.toMs)}&to_ts=${String(WINDOW.fromMs)}&live=false`;
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toContain(
      "window is inverted",
    );
  });

  it("rejects a logs link that is not pinned", () => {
    const url = `https://${CONSOLE_HOST}/logs?query=service%3Aexample-api&from_ts=${String(WINDOW.fromMs)}&to_ts=${String(WINDOW.toMs)}`;
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toContain(
      "must set live=false",
    );
  });

  it("says the pin was absent when the link carries no pin parameter at all", () => {
    const url = `https://${CONSOLE_HOST}/logs?query=service%3Aexample-api&from_ts=${String(WINDOW.fromMs)}&to_ts=${String(WINDOW.toMs)}`;
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toBe(
      "citation: must set live=false to pin the logs view; got (absent)",
    );
  });

  it("quotes back the pin a link did carry when it is the wrong one", () => {
    const url = `https://${CONSOLE_HOST}/logs?query=service%3Aexample-api&from_ts=${String(WINDOW.fromMs)}&to_ts=${String(WINDOW.toMs)}&live=true`;
    expect(refusalLines({ result: validateCitation({ url, expectation: expectation() }) })[0]).toBe(
      "citation: must set live=false to pin the logs view; got true",
    );
  });
});

describe("validateCitation — accumulation", () => {
  it("reports every violation in one pass rather than stopping at the first", () => {
    const url = "https://ap1.datadoghq.com/error-tracking/issues/x?query=%22phrase%22";
    const errors = refusalLines({ result: validateCitation({ url, expectation: expectation() }) });
    // wrong host, wrong path, quoted phrase, no window, no pin, plus the closing rationale line.
    expect(errors.length).toBe(6);
    expect(errors[errors.length - 1]).toContain("worse than citing nothing");
  });
});
