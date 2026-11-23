/**
 * The one request `claude spend` sends, and the key list both usage readers share. What matters is that the request
 * is the usage answer WITHOUT `skip_spend=1`, which is what carries the spend, and that a sibling key the list
 * declares is accepted while one it does not declare stays loud.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { spendStatusRequest } from "../../../claude/spendExchange.js";
import { SPEND_STATUS_URL } from "../../../claude/spendStatus.js";
import { USAGE_SIBLINGS, unread } from "../../../claude/usageWire.js";

describe("spendStatusRequest", () => {
  it("is a GET of the unskipped usage answer, carrying the login's bearer", () => {
    const request = spendStatusRequest({ accessToken: "fake-access" });
    expect(request.url).toBe("https://api.anthropic.com/api/oauth/usage");
    expect(request.url).toBe(SPEND_STATUS_URL);
    expect(request.init.method).toBe("GET");
    expect(new Headers(request.init.headers).get("authorization")).toBe("Bearer fake-access");
  });
});

describe("USAGE_SIBLINGS", () => {
  const strict = z.strictObject({ ...USAGE_SIBLINGS, cedar_ember: unread, extra_usage: unread });

  it("accepts a declared sibling whether it is sent or not", () => {
    expect(strict.safeParse({ seven_day: { utilization: 1 } }).success).toBe(true);
    expect(strict.safeParse({}).success).toBe(true);
  });

  it("stays loud on a key neither list declares", () => {
    const parsed = strict.safeParse({ not_a_declared_key: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.message).toContain("not_a_declared_key");
  });

  it("leaves out the two blocks each reader declares for itself", () => {
    expect(Object.keys(USAGE_SIBLINGS)).not.toContain("cedar_ember");
    expect(Object.keys(USAGE_SIBLINGS)).not.toContain("extra_usage");
    expect(Object.keys(USAGE_SIBLINGS)).toContain("seven_day");
  });
});
