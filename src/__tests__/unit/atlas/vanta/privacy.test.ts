import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  admitVendorContractAmount,
  vantaSensitiveCompanionRelativePath,
  writeVantaSensitiveCompanion,
} from "../../../../atlas/vanta/privacy.js";
import type { VantaAtlasPaths } from "../../../../atlas/vanta/store.js";

describe("vantaSensitiveCompanionRelativePath", () => {
  it("matches the layout writeVantaSensitiveCompanion actually writes to", () => {
    expect(vantaSensitiveCompanionRelativePath({ entityId: "e1", kind: "vendor" })).toBe(
      "atlas/vanta/_sensitive/vendor/e1.json",
    );
  });
});

describe("admitVendorContractAmount", () => {
  it("withholds a present contract amount behind a pointer + pending write", () => {
    const decision = admitVendorContractAmount({ contractAmount: { amount: 100, currency: "USD" }, entityId: "e1" });
    expect(decision.financialDetail).toEqual({
      companionRelativePath: "atlas/vanta/_sensitive/vendor/e1.json",
      hasFinancialDetail: true,
    });
    expect(decision.pendingWrite).toEqual({ entityId: "e1", kind: "vendor", value: { amount: 100, currency: "USD" } });
  });

  it("admits nothing when there is no contract amount", () => {
    const decision = admitVendorContractAmount({ contractAmount: null, entityId: "e1" });
    expect(decision.financialDetail).toBeNull();
    expect(decision.pendingWrite).toBeNull();
  });
});

describe("writeVantaSensitiveCompanion", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vanta-privacy-"));
  });
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("writes the value as JSON under paths.sensitive/<kind>/<entityId>.json", () => {
    const paths: VantaAtlasPaths = {
      directory: dir,
      home: dir,
      kinds: {
        "answer-library-entry": "",
        "control-document-link": "",
        "discovered-vendor-account": "",
        "document-link": "",
        "document-upload": "",
        "framework-control-link": "",
        "group-member": "",
        "integration-resource": "",
        "integration-resource-kind": "",
        "risk-control-link": "",
        "vendor-assessment": "",
        "vendor-document": "",
        "vendor-security-review": "",
        audit: "",
        "browser-operation": "",
        "browser-page": "",
        control: "",
        "customer-trust-account": "",
        "discovered-vendor": "",
        evidence: "",
        "event-shape": "",
        framework: "",
        group: "",
        "importable-idp-group": "",
        integration: "",
        issue: "",
        "library-control": "",
        "monitored-computer": "",
        person: "",
        policy: "",
        "policy-document": "",
        questionnaire: "",
        "questionnaire-assignable-user": "",
        risk: "",
        test: "",
        "trust-tag-category": "",
        user: "",
        vendor: "",
        "vendor-assessment-type": "",
        "vendor-risk-attribute": "",
        vulnerability: "",
        "vulnerability-remediation": "",
        "vulnerable-asset": "",
      },
      manifest: join(dir, "manifest.json"),
      pageArtifacts: join(dir, "artifacts", "pages"),
      sensitive: dir,
      superseded: join(dir, "_superseded"),
    };
    const written = writeVantaSensitiveCompanion({
      paths,
      pending: { entityId: "e1", kind: "vendor", value: { amount: 100, currency: "USD" } },
    });
    expect(written.isOk()).toBe(true);
    const raw = readFileSync(join(dir, "vendor", "e1.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ amount: 100, currency: "USD" });
  });
});
