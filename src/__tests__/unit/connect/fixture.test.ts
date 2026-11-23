import { describe, expect, it } from "vitest";
import { connectFixtureReport, selectConnectFixture } from "../../../connect/fixture.js";
import type { ConnectCapability } from "../../../connect/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

function cap({ caps, id }: { caps: readonly ConnectCapability[]; id: string }): ConnectCapability {
  return caps.find((c) => c.id === id)!;
}

describe("selectConnectFixture", () => {
  it("selects the live path when neither env var is set", () => {
    const result = selectConnectFixture({ env: {} });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBeUndefined();
  });

  it("refuses a scenario named without the harness flag", () => {
    const result = selectConnectFixture({ env: { SLOPWEAVER_CONNECT_FIXTURE: "all-ready" } });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain(
      "SLOPWEAVER_CONNECT_FIXTURE is set but SLOPWEAVER_ONBOARD_HARNESS=1 is not — refusing rather than guessing which mode was meant",
    );
  });

  it("refuses the harness flag with no scenario named", () => {
    const result = selectConnectFixture({ env: { SLOPWEAVER_ONBOARD_HARNESS: "1" } });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain(
      "SLOPWEAVER_ONBOARD_HARNESS=1 but SLOPWEAVER_CONNECT_FIXTURE is not set — name one of: all-ready | slack-warning | notion-hard-gap",
    );
  });

  it("refuses an unrecognised scenario", () => {
    const result = selectConnectFixture({
      env: { SLOPWEAVER_CONNECT_FIXTURE: "everything-on-fire", SLOPWEAVER_ONBOARD_HARNESS: "1" },
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain(
      "unknown SLOPWEAVER_CONNECT_FIXTURE: everything-on-fire (expected all-ready | slack-warning | notion-hard-gap)",
    );
  });

  it("selects a valid scenario when both are set correctly", () => {
    const result = selectConnectFixture({
      env: { SLOPWEAVER_CONNECT_FIXTURE: "notion-hard-gap", SLOPWEAVER_ONBOARD_HARNESS: "1" },
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({ scenario: "notion-hard-gap" });
  });
});

describe("connectFixtureReport", () => {
  it("all-ready: every source reports ok with the fixture marker, never a live probe", () => {
    for (const source of ["github", "slack", "linear", "notion", "gmail", "datadog", "outlook"] as const) {
      const report = connectFixtureReport({ scenario: "all-ready", source });
      expect(report.ok).toBe(true);
      expect(report.source).toBe(source);
      expect(report.fixture).toEqual({ scenario: "all-ready" });
    }
  });

  it("slack-warning: slack reports ok with a reduced-breadth warning; other sources stay unaffected", () => {
    const slack = connectFixtureReport({ scenario: "slack-warning", source: "slack" });
    expect(slack.ok).toBe(true);
    expect(cap({ caps: slack.capabilities, id: "token-breadth" }).status).toBe("warning");

    const github = connectFixtureReport({ scenario: "slack-warning", source: "github" });
    expect(github.ok).toBe(true);
    expect(github.fixture).toEqual({ scenario: "slack-warning" });
  });

  it("notion-hard-gap: notion reports a hard gap; other sources still report ready", () => {
    const notion = connectFixtureReport({ scenario: "notion-hard-gap", source: "notion" });
    expect(notion.ok).toBe(false);
    expect(cap({ caps: notion.capabilities, id: "capability:read-user-email" }).status).toBe("missing");

    const linear = connectFixtureReport({ scenario: "notion-hard-gap", source: "linear" });
    expect(linear.ok).toBe(true);
  });

  it("never carries a token, an SDK client, or a live probe shape — only the classifier's own capability ids", () => {
    const report = connectFixtureReport({ scenario: "all-ready", source: "github" });
    expect(report.capabilities.map((c) => c.id).toSorted()).toEqual(
      ["auth", "capability:saml-email", "read-probe", "scope:read:org"].toSorted(),
    );
  });
});
