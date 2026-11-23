import { describe, expect, it } from "vitest";

import { diagnosticBodyText, publishableCause, requestRedaction } from "../../../../atlas/vanta/transportRedaction.js";

describe("requestRedaction", () => {
  it("redacts the bearer token and every declared value from the path, and withholds a declaring request's body", () => {
    const redaction = requestRedaction({
      requestInit: {
        headers: { Authorization: "Bearer tok-123" },
        path: "/v1/x/tok-123/client-abc",
        sensitiveValues: ["client-abc"],
      },
    });
    expect(redaction.safePath).toBe("/v1/x/[REDACTED]/[REDACTED]");
    expect(redaction.secrets).toEqual(["Bearer tok-123", "tok-123", "client-abc"]);
    expect(redaction.withholdBody).toBe(true);
  });

  it("does not withhold the body of a request that declares no credential", () => {
    const redaction = requestRedaction({ requestInit: { headers: {}, path: "/v1/controls" } });
    expect(redaction).toEqual({ safePath: "/v1/controls", secrets: [], withholdBody: false });
  });
});

describe("diagnosticBodyText", () => {
  it("names only the length of a declaring request's body", () => {
    const text = diagnosticBodyText({ body: '{"echo":"c2VjcmV0"}', secrets: ["secret"], withholdBody: true });
    expect(text).toBe(
      "[body withheld: 19 chars — this request sent declared credentials, which a reflection could carry in any encoding]",
    );
  });

  it("redacts a sent secret before cutting the body to 400 characters", () => {
    const body = `${"x".repeat(395)}secret-value`;
    const text = diagnosticBodyText({ body, secrets: ["secret-value"], withholdBody: false });
    expect(text).toBe(`${"x".repeat(395)}[REDA`);
  });
});

describe("publishableCause", () => {
  it("passes the error through when nothing is withheld", () => {
    const error = new TypeError("fetch failed");
    expect(publishableCause({ error, withholdBody: false })).toBe(error);
  });

  it("keeps only a known class name when the request declared credentials", () => {
    const cause = publishableCause({ error: new TypeError("secret-in-message"), withholdBody: true });
    expect(cause instanceof Error).toBe(true);
    expect(String(cause)).toBe("Error: TypeError (message withheld: this request sent declared credentials)");
  });
});
