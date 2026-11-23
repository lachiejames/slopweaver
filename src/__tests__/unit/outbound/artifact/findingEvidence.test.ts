/**
 * Every Datadog host in this file reads the synthetic `ap1` site, and every `billing` lane or system name is a
 * synthetic one, rather than the installation's own.
 */

import { describe, expect, it } from "vitest";

import {
  FINDING_EVIDENCE_SOURCES,
  findingEvidenceLabel,
  findingEvidenceOf,
} from "../../../../outbound/artifact/findingEvidence.js";

describe("findingEvidenceOf", () => {
  it("lists at least one source beyond Datadog", () => {
    expect(FINDING_EVIDENCE_SOURCES.length).toBeGreaterThan(0);
  });

  it.each([
    ["https://ap1.datadoghq.com/apm/traces?query=env%3Aproduction", "Datadog"],
    ["https://github.com/acme/acme-admin/blob/main/src/billing.ts#L40", "GitHub"],
    ["https://github.com/acme/acme-admin/pull/812", "GitHub"],
    ["https://go.xero.com/Bank/BankTransactions.aspx", "Xero"],
    ["https://app.vanta.com/tests", "Vanta"],
    ["https://falcon.us-2.crowdstrike.com/hosts/hosts", "CrowdStrike"],
    ["https://app.trelica.com/apps", "Trelica"],
    ["https://app.hex.tech/acme/app/abc", "Hex"],
    ["https://admin.google.com/ac/users", "Google Admin"],
    ["https://console.jumpcloud.com/#/users", "JumpCloud"],
    ["https://dash.cloudflare.com/abc/acme.com/dns", "Cloudflare"],
    ["https://app.inngest.com/env/production/functions", "Inngest"],
    ["https://dashboard.knock.app/acme/production/messages", "Knock"],
    ["https://console.twilio.com/us1/monitor/logs/sms", "Twilio"],
  ])("admits %s as %s", (url, name) => {
    expect(findingEvidenceOf({ url })).toEqual({ kind: "admitted", name });
  });

  it.each([
    "https://linear.app/acme/issue/GROW-1888",
    "https://acme.atlassian.net/browse/OPS-1",
    "https://acme.slack.com/archives/C1/p1",
    "https://github.com/acme/acme-admin/issues/12",
    "https://github.com/acme/acme-admin/%69ssues/12",
    "https://github.com/acme/acme-admin//issues/12",
    "https://github.com/acme/acme-admin/Issues/12",
    "https://github.com/acme/acme-admin/discussions/3",
    "https://github.com/orgs/acme/projects/2",
  ])("refuses the tracker or conversation %s by the evidence bar", (url) => {
    const evidence = findingEvidenceOf({ url });
    expect(evidence.kind).toBe("refused");
    expect(evidence).toEqual({
      kind: "refused",
      reason: expect.stringContaining("a tracker link alone is not evidence"),
    });
  });

  it.each([
    "https://example.com/logs",
    "https://ap1.datadoghq.com/monitors/manage",
    "http://go.xero.com/Bank",
    "https://go.xero.com.example.net/Bank",
    "https://notxero.com/Bank",
    "not a url",
  ])("refuses %s as off the list, naming what is admitted", (url) => {
    expect(findingEvidenceOf({ url })).toEqual({ kind: "refused", reason: expect.stringContaining("Xero, Vanta") });
  });
});

describe("findingEvidenceLabel", () => {
  it("names Datadog exactly as the card always has", () => {
    expect(findingEvidenceLabel({ url: "https://ap1.datadoghq.com/logs?query=x" })).toBe("the Datadog view");
  });

  it("names a listed console", () => {
    expect(findingEvidenceLabel({ url: "https://app.trelica.com/apps" })).toBe("the Trelica view");
  });

  it("says the cited view for an address the form refuses", () => {
    expect(findingEvidenceLabel({ url: "https://example.com" })).toBe("the cited view");
  });
});
