/**
 * The redaction the console channel rests on: which segments are values, and which registry operation an
 * observed console call corroborates. Every Datadog host in this file reads the synthetic `ap1` site rather than the
 * install's own.
 */
import { describe, expect, it } from "vitest";

import {
  DATADOG_SEGMENTS,
  DATADOG_TELEMETRY_PARAM,
  reduceDatadogConsoleCalls,
  registryOperationFor,
} from "../../../../atlas/datadog/consoleReduction.js";
import { observedCall } from "../../../../atlas/kit/consoleFold.js";

const ORIGIN = "https://ap1.datadoghq.invalid";

describe("DATADOG_SEGMENTS", () => {
  it("names a uuid, a dashboard id, a bare integer and an opaque token by their own placeholders", () => {
    expect(DATADOG_SEGMENTS({ segment: "00000000-0000-11f0-8000-000000000001" })?.placeholder).toBe("<uuid>");
    expect(DATADOG_SEGMENTS({ segment: "abc-def-ghi" })?.placeholder).toBe("<dashboard>");
    expect(DATADOG_SEGMENTS({ segment: "1234567" })?.placeholder).toBe("<id>");
    expect(DATADOG_SEGMENTS({ segment: "abc-def-ghi-jkl-mno-pqr-stu-vwx" })?.placeholder).toBe("<token>");
  });

  it("leaves a genuine path name alone", () => {
    expect(DATADOG_SEGMENTS({ segment: "monitor" })).toBe(null);
    expect(DATADOG_SEGMENTS({ segment: "v1" })).toBe(null);
  });
});

describe("DATADOG_TELEMETRY_PARAM", () => {
  it("drops session material and keeps a parameter that names what the endpoint accepts", () => {
    expect(DATADOG_TELEMETRY_PARAM.test("_authentication_token")).toBe(true);
    expect(DATADOG_TELEMETRY_PARAM.test("csrf_token")).toBe(true);
    expect(DATADOG_TELEMETRY_PARAM.test("type")).toBe(false);
    expect(DATADOG_TELEMETRY_PARAM.test("from_ts")).toBe(false);
  });
});

describe("registryOperationFor", () => {
  it("matches an observed shape to the registry template with the same method and path", () => {
    const row = registryOperationFor({ method: "GET", pathShape: "/api/v1/dashboard/<dashboard>" });
    expect(row?.path).toBe("/api/v1/dashboard/{dashboard_id}");
    expect(row?.kind).toBe("dashboard");
  });

  it("matches a monitor listed by the console under the SDK's own template", () => {
    expect(registryOperationFor({ method: "GET", pathShape: "/api/v1/monitor" })?.kind).toBe("monitor");
  });

  it("answers null for a UI-only call the SDK does not declare", () => {
    expect(registryOperationFor({ method: "POST", pathShape: "/api/ui/search/suggestions/entities" })).toBe(null);
  });

  it("matches by method too, so a DELETE on a monitor id is the SDK's delete and not its get", () => {
    expect(registryOperationFor({ method: "DELETE", pathShape: "/api/v1/monitor/<id>" })?.name).toBe(
      "v1-monitors-delete-monitor",
    );
    expect(registryOperationFor({ method: "OPTIONS", pathShape: "/api/v1/monitor" })).toBe(null);
  });
});

describe("reduceDatadogConsoleCalls", () => {
  it("folds two calls to one endpoint into one row carrying the registry row it corroborates", () => {
    const calls = [
      observedCall({
        onPage: "/monitors/manage",
        response: {
          body: { monitors: [{ id: 1, name: "x" }] },
          method: "GET",
          statusCode: 200,
          url: `${ORIGIN}/api/v1/monitor?type=metric`,
        },
      }),
      observedCall({
        onPage: "/monitors/triggered",
        response: { body: { monitors: [] }, method: "GET", statusCode: 200, url: `${ORIGIN}/api/v1/monitor?_cb=1` },
      }),
    ];
    const reduced = reduceDatadogConsoleCalls({ calls });

    expect(reduced.length).toBe(1);
    expect(reduced[0]!.pathShape).toBe("/api/v1/monitor");
    expect(reduced[0]!.observedOnPages).toStrictEqual(["/monitors/manage", "/monitors/triggered"]);
    expect(reduced[0]!.paramNames).toStrictEqual(["type"]);
    expect(reduced[0]!.registry?.kind).toBe("monitor");
    expect(reduced[0]!.responseFieldPaths).toContain("monitors[].name");
  });

  it("records a UI-only endpoint with no registry row rather than dropping it", () => {
    const calls = [
      observedCall({
        onPage: "cmd-k",
        response: {
          body: { entities: [] },
          method: "POST",
          statusCode: 200,
          url: `${ORIGIN}/api/ui/search/suggestions/entities`,
        },
      }),
    ];
    const reduced = reduceDatadogConsoleCalls({ calls });
    expect(reduced[0]!.registry).toBe(null);
    expect(reduced[0]!.pathShape).toBe("/api/ui/search/suggestions/entities");
  });
});
