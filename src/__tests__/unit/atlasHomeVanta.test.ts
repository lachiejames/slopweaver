/*
 * The Vanta atlas's generation paths: the four standard paths and all forty-three kind files, hung off whichever
 * atlas root it is handed.
 */
import { describe, expect, it } from "vitest";

import { vantaAtlasPaths } from "../../atlasHomeVanta.js";

describe("vantaAtlasPaths", () => {
  it("lays the Vanta generation out under the atlas root with all forty-three kind files", () => {
    expect(vantaAtlasPaths({ atlasRoot: "/state/atlas" })).toEqual({
      kinds: {
        "answer-library-entry": "/state/atlas/vanta/answer-library-entries.jsonl",
        audit: "/state/atlas/vanta/audits.jsonl",
        "browser-operation": "/state/atlas/vanta/browser-operations.jsonl",
        "browser-page": "/state/atlas/vanta/browser-pages.jsonl",
        control: "/state/atlas/vanta/controls.jsonl",
        "control-document-link": "/state/atlas/vanta/control-document-links.jsonl",
        "customer-trust-account": "/state/atlas/vanta/customer-trust-accounts.jsonl",
        "discovered-vendor": "/state/atlas/vanta/discovered-vendors.jsonl",
        "discovered-vendor-account": "/state/atlas/vanta/discovered-vendor-accounts.jsonl",
        "document-link": "/state/atlas/vanta/document-links.jsonl",
        "document-upload": "/state/atlas/vanta/document-uploads.jsonl",
        "event-shape": "/state/atlas/vanta/event-shapes.jsonl",
        evidence: "/state/atlas/vanta/evidence.jsonl",
        framework: "/state/atlas/vanta/frameworks.jsonl",
        "framework-control-link": "/state/atlas/vanta/framework-control-links.jsonl",
        group: "/state/atlas/vanta/groups.jsonl",
        "group-member": "/state/atlas/vanta/group-members.jsonl",
        "importable-idp-group": "/state/atlas/vanta/importable-idp-groups.jsonl",
        integration: "/state/atlas/vanta/integrations.jsonl",
        "integration-resource": "/state/atlas/vanta/integration-resources.jsonl",
        "integration-resource-kind": "/state/atlas/vanta/integration-resource-kinds.jsonl",
        issue: "/state/atlas/vanta/issues.jsonl",
        "library-control": "/state/atlas/vanta/library-controls.jsonl",
        "monitored-computer": "/state/atlas/vanta/monitored-computers.jsonl",
        person: "/state/atlas/vanta/people.jsonl",
        policy: "/state/atlas/vanta/policies.jsonl",
        "policy-document": "/state/atlas/vanta/policy-documents.jsonl",
        questionnaire: "/state/atlas/vanta/questionnaires.jsonl",
        "questionnaire-assignable-user": "/state/atlas/vanta/questionnaire-assignable-users.jsonl",
        risk: "/state/atlas/vanta/risks.jsonl",
        "risk-control-link": "/state/atlas/vanta/risk-control-links.jsonl",
        test: "/state/atlas/vanta/tests.jsonl",
        "trust-tag-category": "/state/atlas/vanta/trust-tag-categories.jsonl",
        user: "/state/atlas/vanta/users.jsonl",
        vendor: "/state/atlas/vanta/vendors.jsonl",
        "vendor-assessment": "/state/atlas/vanta/vendor-assessments.jsonl",
        "vendor-assessment-type": "/state/atlas/vanta/vendor-assessment-types.jsonl",
        "vendor-document": "/state/atlas/vanta/vendor-documents.jsonl",
        "vendor-risk-attribute": "/state/atlas/vanta/vendor-risk-attributes.jsonl",
        "vendor-security-review": "/state/atlas/vanta/vendor-security-reviews.jsonl",
        vulnerability: "/state/atlas/vanta/vulnerabilities.jsonl",
        "vulnerability-remediation": "/state/atlas/vanta/vulnerability-remediations.jsonl",
        "vulnerable-asset": "/state/atlas/vanta/vulnerable-assets.jsonl",
      },
      manifest: "/state/atlas/vanta/manifest.json",
      root: "/state/atlas/vanta",
      sensitive: "/state/atlas/vanta/_sensitive",
      superseded: "/state/atlas/_superseded/vanta",
    });
  });

  it("hangs every path off whichever atlas root it is handed", () => {
    const paths = vantaAtlasPaths({ atlasRoot: "/other-home/atlas" });
    expect(paths.root).toBe("/other-home/atlas/vanta");
    expect(paths.kinds["control"]).toBe("/other-home/atlas/vanta/controls.jsonl");
    expect(paths.superseded).toBe("/other-home/atlas/_superseded/vanta");
  });
});
