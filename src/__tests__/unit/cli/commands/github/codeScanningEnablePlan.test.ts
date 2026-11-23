import { describe, expect, it } from "vitest";

import { admitDoor } from "../../../../../admit/door.js";
import type { ConfigurationObservation } from "../../../../../cli/commands/github/codeScanningCore.js";
import {
  decideDefaultSetupEnable,
  type EnablePlan,
  enableApprovalGate,
  enableDoorRequest,
  enablePlanView,
  enableWriteDigest,
} from "../../../../../cli/commands/github/codeScanningEnablePlan.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import type { DefaultSetup, RepoSecurityConfiguration } from "../../../../../outbound/github/defaultSetup.js";

const OFF: DefaultSetup = {
  languages: ["javascript-typescript", "actions"],
  querySuite: "default",
  schedule: undefined,
  state: "not-configured",
  updatedAt: "2026-09-01T00:00:00Z",
};

const ATTACHED: RepoSecurityConfiguration = {
  codeScanningDefaultSetup: "enabled",
  enforcement: "unenforced",
  htmlUrl: "https://github.com/organizations/acme/settings/security_products/configurations/view/7",
  id: 7,
  name: "GitHub recommended",
  status: "attached",
  targetType: "global",
};

const FORBIDDEN: IngestError = { kind: "http", message: "Not Found", operation: "op", provider: "github", status: 404 };

const PLAN: EnablePlan = {
  before: OFF,
  configuration: { kind: "none" },
  repository: {
    archived: false,
    fullName: "acme/widgets",
    htmlUrl: "https://github.com/acme/widgets",
    id: 4242,
    name: "widgets",
    ownerLogin: "acme",
  },
  source: { owner: "acme", repo: "widgets" },
};

describe("decideDefaultSetupEnable", () => {
  it("is a no-op when default setup is already configured, even under an enforced configuration", () => {
    const enforced: ConfigurationObservation = { kind: "read", value: { ...ATTACHED, status: "enforced" } };

    expect(decideDefaultSetupEnable({ configuration: enforced, setup: { ...OFF, state: "configured" } })).toEqual({
      kind: "already-enabled",
    });
  });

  it("refuses when the attachment's own status is enforced", () => {
    const configuration: ConfigurationObservation = { kind: "read", value: { ...ATTACHED, status: "enforced" } };

    expect(decideDefaultSetupEnable({ configuration, setup: OFF })).toEqual({ kind: "blocked-enforced" });
  });

  it("refuses when the configuration's own enforcement is enforced", () => {
    const configuration: ConfigurationObservation = { kind: "read", value: { ...ATTACHED, enforcement: "enforced" } };

    expect(decideDefaultSetupEnable({ configuration, setup: OFF })).toEqual({ kind: "blocked-enforced" });
  });

  it("refuses an absent state as unknown, never as off", () => {
    expect(decideDefaultSetupEnable({ configuration: { kind: "none" }, setup: { ...OFF, state: undefined } })).toEqual({
      kind: "unknown-state",
    });
  });

  it("refuses when the configuration could not be read, because enforcement cannot be ruled out", () => {
    const configuration: ConfigurationObservation = { error: FORBIDDEN, kind: "unavailable" };

    expect(decideDefaultSetupEnable({ configuration, setup: OFF })).toEqual({ kind: "unknown-configuration" });
  });

  it("is eligible with no configuration attached", () => {
    expect(decideDefaultSetupEnable({ configuration: { kind: "none" }, setup: OFF })).toEqual({
      configuration: { kind: "none" },
      kind: "eligible",
    });
  });

  it("is eligible under a readable, unenforced configuration", () => {
    const configuration: ConfigurationObservation = { kind: "read", value: ATTACHED };

    expect(decideDefaultSetupEnable({ configuration, setup: OFF })).toEqual({ configuration, kind: "eligible" });
  });
});

describe("enablePlanView", () => {
  it("binds the identity, the setup as read with languages sorted, the configuration and the exact body", () => {
    expect(enablePlanView({ plan: { ...PLAN, configuration: { kind: "read", value: ATTACHED } } })).toEqual({
      action: "code-scanning enable",
      before: {
        languages: ["actions", "javascript-typescript"],
        querySuite: "default",
        schedule: undefined,
        state: "not-configured",
        updatedAt: "2026-09-01T00:00:00Z",
      },
      configuration: {
        codeScanningDefaultSetup: "enabled",
        enforcement: "unenforced",
        id: 7,
        kind: "read",
        name: "GitHub recommended",
        status: "attached",
        targetType: "global",
      },
      patch: { state: "configured" },
      repository: { archived: false, fullName: "acme/widgets", id: 4242 },
      source: "acme/widgets",
    });
  });
});

describe("enableWriteDigest", () => {
  it("is pinned for one plan", () => {
    expect(enableWriteDigest({ plan: PLAN })).toBe("ghrepo-3b6a72701036c168");
  });

  it("ignores language order and the configuration's URL", () => {
    const reordered: EnablePlan = { ...PLAN, before: { ...OFF, languages: ["actions", "javascript-typescript"] } };
    const withUrl: EnablePlan = { ...PLAN, configuration: { kind: "read", value: ATTACHED } };
    const otherUrl: EnablePlan = { ...PLAN, configuration: { kind: "read", value: { ...ATTACHED, htmlUrl: "x" } } };

    expect(enableWriteDigest({ plan: reordered })).toBe(enableWriteDigest({ plan: PLAN }));
    expect(enableWriteDigest({ plan: otherUrl })).toBe(enableWriteDigest({ plan: withUrl }));
  });

  it("moves when anything the write depends on drifts", () => {
    const base = enableWriteDigest({ plan: PLAN });
    const drifted: readonly EnablePlan[] = [
      { ...PLAN, repository: { ...PLAN.repository, id: 4243 } },
      { ...PLAN, repository: { ...PLAN.repository, fullName: "acme/gadgets" } },
      { ...PLAN, repository: { ...PLAN.repository, archived: true } },
      { ...PLAN, before: { ...OFF, updatedAt: "2026-09-02T00:00:00Z" } },
      { ...PLAN, before: { ...OFF, querySuite: "extended" } },
      { ...PLAN, configuration: { kind: "read", value: ATTACHED } },
      { ...PLAN, source: { owner: "acme", repo: "gadgets" } },
    ];

    expect(drifted.length).toBe(7);
    expect(new Set([base, ...drifted.map((plan) => enableWriteDigest({ plan }))]).size).toBe(8);
  });

  it("moves when an attached configuration's enforcement or default-setup setting changes", () => {
    const read = (value: RepoSecurityConfiguration): EnablePlan => ({
      ...PLAN,
      configuration: { kind: "read", value },
    });
    const digests = [
      read(ATTACHED),
      read({ ...ATTACHED, id: 8 }),
      read({ ...ATTACHED, codeScanningDefaultSetup: "disabled" }),
      read({ ...ATTACHED, enforcement: "enforced" }),
    ].map((plan) => enableWriteDigest({ plan }));

    expect(new Set(digests).size).toBe(4);
  });
});

describe("enableApprovalGate and enableDoorRequest", () => {
  const digest = enableWriteDigest({ plan: PLAN });
  const request = enableDoorRequest({ digest, home: "/h", view: enablePlanView({ plan: PLAN }) });
  const preview = "slopweaver github code-scanning enable --repo acme/widgets";

  it("asks the door for approval on an external write naming the exact change", () => {
    expect(request.action).toEqual({ kind: "verb", noun: "github", verb: "code-scanning enable" });
    expect(request.meta).toEqual({
      createsWorkItem: false,
      effect: "external-write",
      home: "/h",
      requiresApproval: true,
    });
    expect(request.artifact).toEqual({ ...enablePlanView({ plan: PLAN }), digest });
  });

  it("passes the exact digest", () => {
    const gates = [enableApprovalGate({ expected: digest, preview, supplied: digest })];

    expect(admitDoor({ env: {}, gates, request }).status).toBe("pass");
  });

  it("holds a stale digest, naming the fresh one, and no override token waives it", () => {
    const gates = [enableApprovalGate({ expected: digest, preview, supplied: "ghrepo-0000000000000000" })];
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: "github.code-scanning-enable-unapproved" },
      gates,
      request,
    });

    expect(decision.status).toBe("hold");
    expect(decision.findings.map((finding) => finding.code)).toEqual(["github.code-scanning-enable-unapproved"]);
    expect(decision.findings[0]!.correction).toContain(`${preview}\` to see the write`);
    expect(decision.findings[0]!.correction).toContain(`--approve ${digest}`);
  });
});
