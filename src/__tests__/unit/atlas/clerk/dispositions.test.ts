/**
 * The disposition registry, which decides what this atlas may do with one operation.
 *
 * Two of its rulings have consequences rather than opinions behind them, and both are asserted directly:
 * the three reads whose 200 body is a credential must never grade as ordinary configuration, and the
 * enumeration of a family whose rows are not held must escape the family's own rule.
 */
import { describe, expect, it } from "vitest";

import { clerkDispositionFor, clerkDispositionRuleIds } from "../../../../atlas/clerk/dispositions.js";

describe("clerkDispositionFor", () => {
  it("excludes the machine secret-key read, naming what comes back", () => {
    const ruling = clerkDispositionFor({ method: "GET", wirePath: "/v1/machines/{machine_id}/secret_key" });
    expect(ruling.disposition).toBe("excluded");
    expect(ruling.ruleId).toBe("machine-secret-key");
    expect(ruling.reason).toContain("secret key");
  });

  it("excludes the API key secret read", () => {
    expect(clerkDispositionFor({ method: "GET", wirePath: "/v1/api_keys/{apiKeyID}/secret" }).ruleId).toBe(
      "api-key-secret",
    );
  });

  it("excludes an end user's third-party OAuth access token", () => {
    expect(
      clerkDispositionFor({ method: "GET", wirePath: "/v1/users/{user_id}/oauth_access_tokens/{provider}" }).ruleId,
    ).toBe("oauth-access-token");
  });

  it("grades a credential read ahead of the end-user rule that would otherwise claim it", () => {
    // `/v1/users/{id}/oauth_access_tokens/{provider}` matches `end-user-directory` too. Being wrong in that
    // direction would still exclude it, but for the wrong reason — and the reason is what tells a reader the
    // response is a live token rather than a person's name.
    expect(
      clerkDispositionFor({ method: "GET", wirePath: "/v1/users/{user_id}/oauth_access_tokens/{provider}" }).reason,
    ).toContain("access token");
  });

  it("excludes every mutation, whatever it addresses", () => {
    const ruling = clerkDispositionFor({ method: "PATCH", wirePath: "/v1/instance" });
    expect(ruling.disposition).toBe("excluded");
    expect(ruling.ruleId).toBe("mutation");
  });

  it("excludes the end-user directory", () => {
    expect(clerkDispositionFor({ method: "GET", wirePath: "/v1/users" }).ruleId).toBe("end-user-directory");
  });

  it("keeps the COUNT over that same family, because a count is the enumeration itself", () => {
    const ruling = clerkDispositionFor({ method: "GET", wirePath: "/v1/users/count" });
    expect(ruling.disposition).toBe("reachable");
    expect(ruling.ruleId).toBe("collection-count");
  });

  it("declares sessions voluminous, because a session is emitted rather than authored", () => {
    const ruling = clerkDispositionFor({ method: "GET", wirePath: "/v1/sessions" });
    expect(ruling.disposition).toBe("voluminous");
    expect(ruling.ruleId).toBe("sessions-and-devices");
  });

  it("keeps the machines that mint tokens reachable while declaring the tokens voluminous", () => {
    expect(clerkDispositionFor({ method: "GET", wirePath: "/v1/machines" }).disposition).toBe("reachable");
    expect(clerkDispositionFor({ method: "GET", wirePath: "/v1/m2m_tokens" }).disposition).toBe("voluminous");
  });

  it("keeps billing plans reachable while declaring statements voluminous, inside one family", () => {
    expect(clerkDispositionFor({ method: "GET", wirePath: "/v1/billing/plans" }).disposition).toBe("reachable");
    expect(clerkDispositionFor({ method: "GET", wirePath: "/v1/billing/statements" }).disposition).toBe("voluminous");
  });

  it("grades an instance setting as reachable configuration", () => {
    const ruling = clerkDispositionFor({ method: "GET", wirePath: "/v1/instance/organization_settings" });
    expect(ruling.disposition).toBe("reachable");
    expect(ruling.ruleId).toBe("configuration-default");
  });

  it("excludes the Platform API's own view of an instance's end users", () => {
    expect(
      clerkDispositionFor({
        method: "GET",
        wirePath: "/v1/platform/applications/{applicationID}/instances/{envOrInsID}/users",
      }).ruleId,
    ).toBe("platform-instance-users");
  });

  it("keeps the Platform API's instance CONFIG reachable, beside the users it excludes", () => {
    expect(
      clerkDispositionFor({
        method: "GET",
        wirePath: "/v1/platform/applications/{applicationID}/instances/{envOrInsID}/config",
      }).disposition,
    ).toBe("reachable");
  });
});

describe("clerkDispositionRuleIds", () => {
  it("names every rule the registry can return, sorted", () => {
    const ids = clerkDispositionRuleIds();
    expect(ids).toContain("machine-secret-key");
    expect(ids).toContain("configuration-default");
    expect([...ids].toSorted()).toEqual([...ids]);
  });

  it("has no duplicate id, so a dead-rule gap can name exactly one rule", () => {
    const ids = clerkDispositionRuleIds();
    expect(new Set(ids).size).toBe(ids.length);
  });
});
