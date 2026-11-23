/**
 * The Vanta atlas's own paths, in a module of their own rather than in `atlasHome.ts`, so that file sits
 * under the `file-size-ratchet` cap. `atlasHomeGoogle.ts` is the precedent.
 */
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the Vanta atlas's paths. Split out of `./atlasHome.ts`'s `atlasHomePaths` for the same line-count reason.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function vantaAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      "answer-library-entry": "answer-library-entries.jsonl",
      "control-document-link": "control-document-links.jsonl",
      "discovered-vendor-account": "discovered-vendor-accounts.jsonl",
      "document-link": "document-links.jsonl",
      "document-upload": "document-uploads.jsonl",
      "framework-control-link": "framework-control-links.jsonl",
      "group-member": "group-members.jsonl",
      "integration-resource": "integration-resources.jsonl",
      "integration-resource-kind": "integration-resource-kinds.jsonl",
      "risk-control-link": "risk-control-links.jsonl",
      "vendor-assessment": "vendor-assessments.jsonl",
      "vendor-document": "vendor-documents.jsonl",
      "vendor-security-review": "vendor-security-reviews.jsonl",
      audit: "audits.jsonl",
      "browser-operation": "browser-operations.jsonl",
      "browser-page": "browser-pages.jsonl",
      control: "controls.jsonl",
      "customer-trust-account": "customer-trust-accounts.jsonl",
      "discovered-vendor": "discovered-vendors.jsonl",
      evidence: "evidence.jsonl",
      "event-shape": "event-shapes.jsonl",
      framework: "frameworks.jsonl",
      group: "groups.jsonl",
      "importable-idp-group": "importable-idp-groups.jsonl",
      integration: "integrations.jsonl",
      issue: "issues.jsonl",
      "library-control": "library-controls.jsonl",
      "monitored-computer": "monitored-computers.jsonl",
      person: "people.jsonl",
      policy: "policies.jsonl",
      "policy-document": "policy-documents.jsonl",
      questionnaire: "questionnaires.jsonl",
      "questionnaire-assignable-user": "questionnaire-assignable-users.jsonl",
      risk: "risks.jsonl",
      test: "tests.jsonl",
      "trust-tag-category": "trust-tag-categories.jsonl",
      user: "users.jsonl",
      vendor: "vendors.jsonl",
      "vendor-assessment-type": "vendor-assessment-types.jsonl",
      "vendor-risk-attribute": "vendor-risk-attributes.jsonl",
      vulnerability: "vulnerabilities.jsonl",
      "vulnerability-remediation": "vulnerability-remediations.jsonl",
      "vulnerable-asset": "vulnerable-assets.jsonl",
    },
    platform: "vanta",
  });
}
