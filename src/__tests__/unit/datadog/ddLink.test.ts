/**
 * Every Datadog host in this file reads a synthetic site, `us3` or `ap1`, rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import type { DdConsoleHost } from "../../../datadog/config.js";
import { ddConsoleLink } from "../../../datadog/ddLink.js";
import type { AbsoluteWindow } from "../../../datadog/window.js";

const WINDOW: AbsoluteWindow = { fromMs: 1_785_000_000_000, toMs: 1_785_000_060_000 };
const HOST = "us3.datadoghq.com";

describe("ddConsoleLink", () => {
  it("freezes a logs link with from_ts/to_ts/live=false", () => {
    expect(ddConsoleLink({ consoleHost: HOST, domain: "logs", query: "service:api", window: WINDOW })).toBe(
      "https://us3.datadoghq.com/logs?query=service%3Aapi&from_ts=1785000000000&to_ts=1785000060000&live=false",
    );
  });

  it("freezes a traces link with from_ts/to_ts/live=false, which is what the console actually honours", () => {
    expect(ddConsoleLink({ consoleHost: HOST, domain: "traces", query: "service:api", window: WINDOW })).toBe(
      "https://us3.datadoghq.com/apm/traces?query=service%3Aapi&from_ts=1785000000000&to_ts=1785000060000&live=false",
    );
  });

  it("freezes a rum link with the same params as traces", () => {
    expect(ddConsoleLink({ consoleHost: HOST, domain: "rum", query: "*", window: WINDOW })).toBe(
      "https://us3.datadoghq.com/rum?query=*&start=1785000000000&end=1785000060000&paused=true",
    );
  });

  it("never puts the APM freeze params on a logs link — the bug this builder exists for", () => {
    const link = ddConsoleLink({ consoleHost: HOST, domain: "logs", query: "*", window: WINDOW });
    expect(link).toContain("live=false");
    expect(link).not.toContain("paused=true");
    expect(link).not.toContain("&start=");
  });

  it("never puts the APM freeze params on a traces link — MEASURED to clamp the view to 15 minutes", () => {
    const link = ddConsoleLink({ consoleHost: HOST, domain: "traces", query: "*", window: WINDOW });
    expect(link).toContain("live=false");
    expect(link).toContain("from_ts=1785000000000");
    expect(link).not.toContain("paused=true");
    expect(link).not.toContain("&start=");
  });

  it("still freezes rum with the APM params, which nobody has re-measured", () => {
    const link = ddConsoleLink({ consoleHost: HOST, domain: "rum", query: "*", window: WINDOW });
    expect(link).toContain("paused=true");
    expect(link).not.toContain("live=false");
  });

  it("builds against the console host it is given, not a hard-coded one", () => {
    const link = ddConsoleLink({ consoleHost: "app.datadoghq.com", domain: "logs", query: "*", window: WINDOW });
    expect(link.startsWith("https://app.datadoghq.com/logs?")).toBe(true);
  });

  it("encodes a query containing characters that would break the URL", () => {
    const link = ddConsoleLink({
      consoleHost: HOST,
      domain: "logs",
      query: "env:(prod OR production) @http.status_code:>=500",
      window: WINDOW,
    });
    expect(link).toContain("query=env%3A(prod%20OR%20production)%20%40http.status_code%3A%3E%3D500");
  });

  it("trims a query rather than encoding the whitespace", () => {
    expect(ddConsoleLink({ consoleHost: HOST, domain: "logs", query: "  *  ", window: WINDOW })).toContain("query=*&");
  });

  it("appends extra params after the freeze params", () => {
    const link = ddConsoleLink({
      consoleHost: HOST,
      domain: "logs",
      query: "*",
      window: WINDOW,
      extraParams: "cols=status,%40status",
    });
    expect(link.endsWith("&live=false&cols=status,%40status")).toBe(true);
  });

  it("adds nothing for an empty extraParams", () => {
    expect(ddConsoleLink({ consoleHost: HOST, domain: "logs", query: "*", window: WINDOW, extraParams: "" })).toBe(
      ddConsoleLink({ consoleHost: HOST, domain: "logs", query: "*", window: WINDOW }),
    );
  });
});

describe("ddConsoleLink — a dead host is never composed", () => {
  // The type already refuses a hand-typed host; the cast stands in for what reaches the builder as a plain string
  // anyway — a JSON round trip, a widened type — which is the case the runtime check exists for.
  const DEAD = "app.ap1.datadoghq.com" as DdConsoleHost;

  it("throws on a regional site's dead app. host, naming ap1.datadoghq.com as the console", () => {
    expect(() => ddConsoleLink({ consoleHost: DEAD, domain: "logs", query: "*", window: WINDOW })).toThrow(
      "app.ap1.datadoghq.com is not a Datadog console host — the console is ap1.datadoghq.com",
    );
  });

  it("throws on a host that is no console at all, listing the real ones", () => {
    expect(() =>
      ddConsoleLink({ consoleHost: "example.com" as DdConsoleHost, domain: "logs", query: "*", window: WINDOW }),
    ).toThrow("example.com is not a Datadog console host; expected one of app.datadoghq.com");
  });

  it("still builds against the correct ap1 console host", () => {
    expect(
      ddConsoleLink({ consoleHost: "ap1.datadoghq.com", domain: "logs", query: "*", window: WINDOW }).startsWith(
        "https://ap1.datadoghq.com/logs?",
      ),
    ).toBe(true);
  });
});
