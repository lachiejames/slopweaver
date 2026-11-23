/*
 * The SECURITY configuration projections: a repository's security-and-analysis statuses, an organisation's code
 * security configuration, and a repository's code scanning default setup. Each status is read from its own
 * nested object or key, with decoys at every other level.
 */
import { describe, expect, it } from "vitest";

import {
  projectGithubCodeScanningDefaultSetup,
  projectGithubCodeSecurityConfiguration,
} from "../../../../../atlas/github/projectionConfig.js";
import { projectGithubRepositorySecuritySettings } from "../../../../../atlas/github/projectionSettings.js";
import { CONTEXT, scopedFields } from "./harness.js";

describe("projectGithubRepositorySecuritySettings", () => {
  it("reads each status from its own nested object", () => {
    const projected = projectGithubRepositorySecuritySettings({
      context: CONTEXT,
      raw: {
        html_url: "https://github.com/acme-config/security-repo",
        id: 8201,
        secret_scanning: { status: "top-level-decoy" },
        security_and_analysis: {
          advanced_security: { status: "advanced-on" },
          dependabot_security_updates: { status: "dependabot-off" },
          secret_scanning: { status: "scanning-on" },
          secret_scanning_non_provider_patterns: { status: "non-provider-off" },
          secret_scanning_push_protection: { status: "push-protection-on" },
          secret_scanning_validity_checks: { status: "validity-off" },
          status: "analysis-level-decoy",
        },
        status: "body-level-decoy",
      },
      scopeRef: "acme-config/security-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: "https://github.com/acme-config/security-repo",
        deepLinkStatus: "provider-provided",
        kind: "repository-security-settings",
        providerId: "acme-config/security-repo",
        scopeLevel: "repository",
        scopeRef: "acme-config/security-repo",
      }),
      advancedSecurity: "advanced-on",
      dependabotSecurityUpdates: "dependabot-off",
      secretScanning: "scanning-on",
      secretScanningNonProviderPatterns: "non-provider-off",
      secretScanningPushProtection: "push-protection-on",
      secretScanningValidityChecks: "validity-off",
    });
  });

  it("reads a missing, non-object or empty nested status as null", () => {
    const projected = projectGithubRepositorySecuritySettings({
      context: CONTEXT,
      raw: {
        security_and_analysis: {
          advanced_security: "enabled-but-not-an-object",
          dependabot_security_updates: { status: "" },
          secret_scanning: { state: "wrong-key" },
          secret_scanning_validity_checks: { status: "validity-only" },
        },
      },
      scopeRef: "acme-config/partial-security-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "repository-security-settings",
        providerId: "acme-config/partial-security-repo",
        scopeLevel: "repository",
        scopeRef: "acme-config/partial-security-repo",
      }),
      advancedSecurity: null,
      dependabotSecurityUpdates: null,
      secretScanning: null,
      secretScanningNonProviderPatterns: null,
      secretScanningPushProtection: null,
      secretScanningValidityChecks: "validity-only",
    });
  });

  it("refuses a body with no security-and-analysis object, or no body at all", () => {
    const refuse = ({ raw }: { raw: unknown }): unknown =>
      projectGithubRepositorySecuritySettings({ context: CONTEXT, raw, scopeRef: "acme-config/no-security" });
    expect(refuse({ raw: { html_url: "https://github.com/acme-config/no-security" } })).toBe(null);
    expect(refuse({ raw: { security_and_analysis: "enabled" } })).toBe(null);
    expect(refuse({ raw: "not-a-body" })).toBe(null);
  });
});

describe("projectGithubCodeSecurityConfiguration", () => {
  it("keeps every setting from its own key", () => {
    const projected = projectGithubCodeSecurityConfiguration({
      context: CONTEXT,
      raw: {
        advanced_security: "adv-sec-enabled",
        code_scanning_default_setup: "csds-enabled",
        dependabot_alerts: "dep-alerts-enabled",
        dependabot_security_updates: "dep-updates-disabled",
        dependency_graph: "graph-enabled",
        dependency_graph_autosubmit_action: "autosubmit-not-set",
        description: "config-description",
        enforcement: "enforced-config",
        html_url: "https://github.com/organizations/acme-config/settings/security_products/configurations/9301",
        id: 9301,
        name: "hardened-config-name",
        private_vulnerability_reporting: "pvr-enabled",
        secret_scanning: "ss-enabled",
        secret_scanning_non_provider_patterns: "ss-np-disabled",
        secret_scanning_push_protection: "ss-pp-enabled",
        secret_scanning_validity_checks: "ss-vc-disabled",
        target_type: "global-target",
      },
      scopeRef: "acme-config-security-org",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: "https://github.com/organizations/acme-config/settings/security_products/configurations/9301",
        deepLinkStatus: "provider-provided",
        kind: "code-security-configuration",
        providerId: "9301",
        scopeLevel: "organization",
        scopeRef: "acme-config-security-org",
      }),
      advancedSecurity: "adv-sec-enabled",
      codeScanningDefaultSetup: "csds-enabled",
      dependabotAlerts: "dep-alerts-enabled",
      dependabotSecurityUpdates: "dep-updates-disabled",
      dependencyGraph: "graph-enabled",
      dependencyGraphAutosubmitAction: "autosubmit-not-set",
      description: "config-description",
      enforcement: "enforced-config",
      name: "hardened-config-name",
      privateVulnerabilityReporting: "pvr-enabled",
      secretScanning: "ss-enabled",
      secretScanningNonProviderPatterns: "ss-np-disabled",
      secretScanningPushProtection: "ss-pp-enabled",
      secretScanningValidityChecks: "ss-vc-disabled",
      targetType: "global-target",
    });
  });

  it("reads every absent setting as null and falls back to the name for the provider id", () => {
    const projected = projectGithubCodeSecurityConfiguration({
      context: CONTEXT,
      raw: { name: "bare-config-name" },
      scopeRef: "acme-config-bare-org",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "code-security-configuration",
        providerId: "bare-config-name",
        scopeLevel: "organization",
        scopeRef: "acme-config-bare-org",
      }),
      advancedSecurity: null,
      codeScanningDefaultSetup: null,
      dependabotAlerts: null,
      dependabotSecurityUpdates: null,
      dependencyGraph: null,
      dependencyGraphAutosubmitAction: null,
      description: null,
      enforcement: null,
      name: "bare-config-name",
      privateVulnerabilityReporting: null,
      secretScanning: null,
      secretScanningNonProviderPatterns: null,
      secretScanningPushProtection: null,
      secretScanningValidityChecks: null,
      targetType: null,
    });
  });

  it("refuses a configuration with no name, an empty name, or no body", () => {
    const refuse = ({ raw }: { raw: unknown }): unknown =>
      projectGithubCodeSecurityConfiguration({ context: CONTEXT, raw, scopeRef: "acme-config" });
    expect(refuse({ raw: { description: "nameless", id: 9302 } })).toBe(null);
    expect(refuse({ raw: { name: "" } })).toBe(null);
    expect(refuse({ raw: "not-a-body" })).toBe(null);
  });
});

describe("projectGithubCodeScanningDefaultSetup", () => {
  it("keeps the setup, sorting and de-duplicating languages and normalising the time to UTC", () => {
    const projected = projectGithubCodeScanningDefaultSetup({
      context: CONTEXT,
      raw: {
        html_url: "https://github.com/acme-config/scanning-repo/ignored",
        id: 9401,
        languages: ["typescript", "go", "typescript", ""],
        query_suite: "extended-suite",
        runner_label: "large-runner-label",
        runner_type: "labeled-runner",
        schedule: "weekly-schedule",
        state: "configured-state",
        updated_at: "2026-09-05T10:30:00+10:00",
      },
      scopeRef: "acme-config/scanning-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "code-scanning-default-setup",
        providerId: "acme-config/scanning-repo",
        scopeLevel: "repository",
        scopeRef: "acme-config/scanning-repo",
      }),
      languages: ["go", "typescript"],
      querySuite: "extended-suite",
      runnerLabel: "large-runner-label",
      runnerType: "labeled-runner",
      schedule: "weekly-schedule",
      state: "configured-state",
      updatedAt: "2026-09-05T00:30:00.000Z",
    });
  });

  it("reads every absent field as null or empty", () => {
    const projected = projectGithubCodeScanningDefaultSetup({
      context: CONTEXT,
      raw: { state: "not-configured-state", updated_at: "not-a-time" },
      scopeRef: "acme-config/unscanned-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "code-scanning-default-setup",
        providerId: "acme-config/unscanned-repo",
        scopeLevel: "repository",
        scopeRef: "acme-config/unscanned-repo",
      }),
      languages: [],
      querySuite: null,
      runnerLabel: null,
      runnerType: null,
      schedule: null,
      state: "not-configured-state",
      updatedAt: null,
    });
  });

  it("refuses a setup with no state, an empty state, or no body", () => {
    const refuse = ({ raw }: { raw: unknown }): unknown =>
      projectGithubCodeScanningDefaultSetup({ context: CONTEXT, raw, scopeRef: "acme-config/scanning-repo" });
    expect(refuse({ raw: { languages: ["go"], query_suite: "default" } })).toBe(null);
    expect(refuse({ raw: { state: "" } })).toBe(null);
    expect(refuse({ raw: null })).toBe(null);
  });
});
