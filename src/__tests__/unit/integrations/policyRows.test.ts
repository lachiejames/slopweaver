/**
 * The browser write register and the access review's platforms, derived from each manifest: both equal the literals
 * they replaced, whole records and in order, and a fixture integration with only a manifest appears in them.
 */
import { describe, expect, it } from "vitest";

import { ACCESS_LEVEL_TABLE, ROSTER_SPINE } from "../../../accessReview/levels.js";
import { classifyBrowserUrl, registeredWritePlatforms } from "../../../admit/browserSurface.js";
import type { IntegrationManifest } from "../../../integrations/manifest.js";
import { accessReviewRowsOf, browserWriteRowsOf } from "../../../integrations/policyRows.js";
import { registeredIntegrations } from "../../../integrations/registry.js";

/** The register `src/admit/browserSurface.ts` spelled by hand before it was derived. */
const HAND_KEPT_REGISTER = [
  {
    door: "slopweaver slack read-thread / slack post / slack as-me",
    hosts: ["slack.com", "slack-edge.com"],
    policy: "read-before-write",
    provider: "Slack",
  },
  {
    door: "slopweaver github read / checks / pr / comment / thread",
    hosts: ["github.com", "githubusercontent.com"],
    policy: "read-before-write",
    provider: "GitHub",
  },
  {
    door: "slopweaver linear read / issue / comment / project",
    hosts: ["linear.app"],
    policy: "read-before-write",
    provider: "Linear",
  },
  {
    door: "slopweaver notion read / page / verify",
    hosts: ["notion.so", "notion.site"],
    policy: "read-before-write",
    provider: "Notion",
  },
  {
    door: "slopweaver atlas vanta shot --control <id> (photographs ONE control at its own address and refuses an id the atlas cannot place — a picture of the controls INDEX proves nothing about one control) / atlas vanta vulnerabilities (--html for a screenshot-able findings list) / atlas vanta render [--out <path>] (screenshot-able HTML of what the atlas ALREADY STORED, reaching Vanta not at all — so `atlas vanta walk` is what photographs a live page into it first, and render alone shows you nothing nobody walked) / atlas vanta read / atlas vanta sync / write vanta deactivate",
    hosts: ["vanta.com"],
    policy: "read-before-write",
    provider: "Vanta",
  },
  {
    door: null,
    hosts: ["datadoghq.com", "datadoghq.eu", "ddog-gov.com"],
    policy: "read-before-write",
    provider: "Datadog",
  },
  { door: null, hosts: ["jumpcloud.com"], policy: "refuse-every-write", provider: "JumpCloud" },
];

/** The access rows `src/accessReview/levels.ts` spelled by hand before they were derived. */
const HAND_KEPT_ACCESS_LEVELS = [
  {
    display: "JumpCloud",
    displayPath: ["displayname"],
    emailPath: ["email"],
    holds: [{ label: "state", whenValue: ["ACTIVATED"] }],
    kind: "systemusers",
    levels: [
      { label: "state", path: ["state"] },
      { label: "suspended", path: ["suspended"] },
      { label: "console role", path: ["admin", "roleName"] },
      { label: "mfa configured", path: ["mfa", "configured"] },
      { label: "totp enrolled", path: ["totp_enabled"] },
      { label: "mfa enrollment", path: ["mfaEnrollment", "overallStatus"] },
      { label: "department", path: ["department"] },
      { label: "job title", path: ["jobTitle"] },
    ],
    platform: "jumpcloud",
    surfaceFamily: "v1-systemusers-get",
  },
  {
    display: "Cloudflare Access",
    displayPath: ["name"],
    emailPath: ["email"],
    holds: [
      { label: "access seat", whenValue: ["true"] },
      { label: "gateway seat", whenValue: ["true"] },
    ],
    kind: "access-user",
    levels: [
      { label: "access seat", path: ["accessSeat"] },
      { label: "gateway seat", path: ["gatewaySeat"] },
      { label: "last successful login", path: ["lastSuccessfulLogin"] },
    ],
    platform: "cloudflare",
    surfaceFamily: null,
  },
  {
    display: "1Password",
    displayPath: ["name"],
    emailPath: ["email"],
    holds: [{ label: "state", whenValue: ["ACTIVE"] }],
    kind: "user",
    levels: [
      { label: "state", path: ["state"] },
      { label: "type", path: ["type"] },
      { label: "last auth", path: ["last_auth_at"] },
    ],
    platform: "onepassword",
    surfaceFamily: null,
  },
];

/** The roster spine `src/accessReview/levels.ts` spelled by hand before it was derived. */
const HAND_KEPT_SPINE = {
  display: "Vanta",
  displayPath: ["name", "display"],
  emailPath: ["emailAddress"],
  holds: [{ label: "employment status", whenValue: ["CURRENT"] }],
  kind: "person",
  levels: [
    { label: "employment status", path: ["employment", "status"] },
    { label: "employment end date", path: ["employment", "endDate"] },
    { label: "job title", path: ["employment", "jobTitle"] },
  ],
  platform: "vanta",
  surfaceFamily: null,
};

const FIXTURE_SPEC = {
  display: "Acme",
  displayPath: ["name"],
  emailPath: ["email"],
  holds: [{ label: "state", whenValue: ["ACTIVE"] }],
  kind: "user",
  levels: [{ label: "state", path: ["state"] }],
  platform: "acme",
  surfaceFamily: null,
} as const;

/** A manifest-only fixture integration with a row in both tables. */
const FIXTURE = {
  accessReview: { ordinal: 1.5, role: "access-level", spec: FIXTURE_SPEC },
  browserWrite: {
    ordinal: 2.5,
    row: { door: null, hosts: ["acme.example"], policy: "refuse-every-write", provider: "Acme" },
  },
  features: { read: async () => (await import("../../../live/github/read.js")).parseGithubReadAddress },
  id: "acme",
  name: "Acme",
} as const satisfies IntegrationManifest;

describe("the browser write register, derived from the manifests", () => {
  const derived = browserWriteRowsOf({ manifests: registeredIntegrations() });

  it("equals the hand-kept register, whole records and in order", () => {
    expect(derived).toEqual(HAND_KEPT_REGISTER);
  });

  it("is what the guard reads", () => {
    expect(registeredWritePlatforms()).toEqual(HAND_KEPT_REGISTER.map((row) => row.provider));
    expect(classifyBrowserUrl({ url: "https://app.jumpcloud.com/x" })!.policy).toBe("refuse-every-write");
  });

  it("does not depend on the order the manifests arrive in", () => {
    expect(browserWriteRowsOf({ manifests: registeredIntegrations().toReversed() })).toEqual(derived);
  });

  it("carries a fixture manifest's row to the place its ordinal names", () => {
    const providers = browserWriteRowsOf({ manifests: [...registeredIntegrations(), FIXTURE] }).map(
      (row) => row.provider,
    );
    expect(providers).toEqual(["Slack", "GitHub", "Linear", "Acme", "Notion", "Vanta", "Datadog", "JumpCloud"]);
  });

  it("leaves a platform nothing declares unregistered", () => {
    expect(classifyBrowserUrl({ url: "https://acme.example/" })).toBe(undefined);
  });

  it("refuses two rows sharing an ordinal", () => {
    const clash = { ...FIXTURE, browserWrite: { ...FIXTURE.browserWrite, ordinal: 0 } };
    expect(() => browserWriteRowsOf({ manifests: [...registeredIntegrations(), clash] })).toThrow(
      "browser write register: two rows share an ordinal",
    );
  });

  it("is frozen", () => {
    expect(Object.isFrozen(derived)).toBe(true);
  });
});

describe("the access review's platforms, derived from the manifests", () => {
  const derived = accessReviewRowsOf({ manifests: registeredIntegrations() });

  it("equals the hand-kept tables, whole records and in order", () => {
    expect(derived.accessLevels).toEqual(HAND_KEPT_ACCESS_LEVELS);
    expect(derived.rosterSpine).toEqual(HAND_KEPT_SPINE);
  });

  it("is what the report reads", () => {
    expect(ACCESS_LEVEL_TABLE).toEqual(HAND_KEPT_ACCESS_LEVELS);
    expect(ROSTER_SPINE).toEqual(HAND_KEPT_SPINE);
  });

  it("does not depend on the order the manifests arrive in", () => {
    expect(accessReviewRowsOf({ manifests: registeredIntegrations().toReversed() })).toEqual(derived);
  });

  it("carries a fixture manifest's row to the place its ordinal names, leaving the spine alone", () => {
    const rows = accessReviewRowsOf({ manifests: [...registeredIntegrations(), FIXTURE] });
    expect(rows.accessLevels.map((spec) => spec.platform)).toEqual(["jumpcloud", "cloudflare", "acme", "onepassword"]);
    expect(rows.rosterSpine.platform).toBe("vanta");
  });

  it("refuses a second roster spine", () => {
    const spine = { ...FIXTURE, accessReview: { ...FIXTURE.accessReview, role: "roster-spine" } } as const;
    expect(() => accessReviewRowsOf({ manifests: [...registeredIntegrations(), spine] })).toThrow(
      "expected exactly one roster spine, found 2",
    );
  });

  it("refuses no roster spine at all", () => {
    expect(() => accessReviewRowsOf({ manifests: [] })).toThrow("expected exactly one roster spine, found 0");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(derived.accessLevels)).toBe(true);
  });
});
