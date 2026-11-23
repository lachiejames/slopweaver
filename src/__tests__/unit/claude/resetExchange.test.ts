import { describe, expect, it } from "vitest";

import { exchange, type ResetSend, resetClaimRequest, resetStatusRequest } from "../../../claude/resetExchange.js";
import { RESET_STATUS_URL } from "../../../claude/resetStatus.js";

/** A transport that answers every request with one fixed response. */
function answering({
  body,
  headers,
  status,
}: {
  body: string;
  headers: Record<string, string>;
  status: number;
}): ResetSend {
  return async () => new Response(body, { headers, status });
}

describe("resetStatusRequest / resetClaimRequest", () => {
  it("reads the status with a GET carrying the bearer", () => {
    const request = resetStatusRequest({ accessToken: "tok" });
    expect(request.url).toBe(RESET_STATUS_URL);
    expect(request.init.method).toBe("GET");
    expect(new Headers(request.init.headers).get("authorization")).toBe("Bearer tok");
  });

  it("sends a claim as a POST of the body it was given, to the url it was given", () => {
    const request = resetClaimRequest({ accessToken: "tok", body: '{"a":1}', url: "https://example.test/claim" });
    expect(request.url).toBe("https://example.test/claim");
    expect(request.init.method).toBe("POST");
    expect(request.init.body).toBe('{"a":1}');
    expect(new Headers(request.init.headers).get("anthropic-beta")).toBe("oauth-2025-04-20");
  });
});

describe("exchange", () => {
  const request = resetStatusRequest({ accessToken: "tok" });

  it("returns the status and body text", async () => {
    const response = await exchange({ request, send: answering({ body: "{}", headers: {}, status: 200 }) });
    expect(response).toEqual({ bodyText: "{}", status: 200 });
  });

  it("carries a whole-second retry-after", async () => {
    const send = answering({ body: "", headers: { "retry-after": "3568" }, status: 429 });
    expect(await exchange({ request, send })).toEqual({ bodyText: "", retryAfterSeconds: 3568, status: 429 });
  });

  it("drops a retry-after that is not a whole number of seconds", async () => {
    const send = answering({ body: "", headers: { "retry-after": "Wed, 30 Sep 2026 11:00:00 GMT" }, status: 429 });
    expect(await exchange({ request, send })).toEqual({ bodyText: "", status: 429 });
  });

  it("keeps nothing a throwing transport carried, bearer included", async () => {
    const send: ResetSend = async () => {
      throw new Error("connect ECONNREFUSED with Bearer tok");
    };
    const response = await exchange({ request, send });
    expect(response).toEqual({ reason: "the request failed before an answer came back" });
    expect(JSON.stringify(response)).not.toContain("tok");
  });
});
