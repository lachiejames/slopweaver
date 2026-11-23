/**
 * The generation a Vanta sync merges against, one file per kind. Out of `sync.ts`, which holds the lock, the
 * trusted read and the publish; this is the pure table between the read and the merge.
 */
import { emptyVantaKindFile, type VantaKind, type VantaKindFile } from "./model.js";

/**
 * One file per kind, taken from the snapshot and defaulted to an empty file for a kind never published.
 *
 * Hand-listed rather than derived from `VANTA_KINDS`, and that is deliberate: `Object.fromEntries` widens
 * to a string index signature, so deriving it needs a type assertion the `no-unsafe-type-assertion` rule
 * refuses. The compiler checks this list is total, which is what makes the churn of adding a kind safe
 * rather than merely tedious — it caught eight omissions on the day the census families landed.
 *
 * @param snapshotFiles what the store read, keyed by kind and `null` for a kind never published
 * @param at this run's ISO timestamp, stamped on an empty file
 * @returns every kind's file
 */
export function storedFilesFrom({
  snapshotFiles,
  at,
}: {
  snapshotFiles: Readonly<Record<VantaKind, VantaKindFile | null>>;
  at: string;
}): Record<VantaKind, VantaKindFile> {
  const storedFileFor = ({ kind }: { kind: VantaKind }): VantaKindFile => {
    const stored = snapshotFiles[kind];
    if (stored === null) {
      return emptyVantaKindFile({ kind, updatedAt: at });
    }
    return stored;
  };
  return {
    "answer-library-entry": storedFileFor({ kind: "answer-library-entry" }),
    "control-document-link": storedFileFor({ kind: "control-document-link" }),
    "discovered-vendor-account": storedFileFor({ kind: "discovered-vendor-account" }),
    "document-link": storedFileFor({ kind: "document-link" }),
    "document-upload": storedFileFor({ kind: "document-upload" }),
    "framework-control-link": storedFileFor({ kind: "framework-control-link" }),
    "group-member": storedFileFor({ kind: "group-member" }),
    "integration-resource": storedFileFor({ kind: "integration-resource" }),
    "integration-resource-kind": storedFileFor({ kind: "integration-resource-kind" }),
    "risk-control-link": storedFileFor({ kind: "risk-control-link" }),
    "vendor-assessment": storedFileFor({ kind: "vendor-assessment" }),
    "vendor-document": storedFileFor({ kind: "vendor-document" }),
    "vendor-security-review": storedFileFor({ kind: "vendor-security-review" }),
    audit: storedFileFor({ kind: "audit" }),
    "browser-operation": storedFileFor({ kind: "browser-operation" }),
    "browser-page": storedFileFor({ kind: "browser-page" }),
    control: storedFileFor({ kind: "control" }),
    "customer-trust-account": storedFileFor({ kind: "customer-trust-account" }),
    "discovered-vendor": storedFileFor({ kind: "discovered-vendor" }),
    evidence: storedFileFor({ kind: "evidence" }),
    "event-shape": storedFileFor({ kind: "event-shape" }),
    framework: storedFileFor({ kind: "framework" }),
    group: storedFileFor({ kind: "group" }),
    "importable-idp-group": storedFileFor({ kind: "importable-idp-group" }),
    integration: storedFileFor({ kind: "integration" }),
    issue: storedFileFor({ kind: "issue" }),
    "library-control": storedFileFor({ kind: "library-control" }),
    "monitored-computer": storedFileFor({ kind: "monitored-computer" }),
    person: storedFileFor({ kind: "person" }),
    policy: storedFileFor({ kind: "policy" }),
    "policy-document": storedFileFor({ kind: "policy-document" }),
    questionnaire: storedFileFor({ kind: "questionnaire" }),
    "questionnaire-assignable-user": storedFileFor({ kind: "questionnaire-assignable-user" }),
    risk: storedFileFor({ kind: "risk" }),
    test: storedFileFor({ kind: "test" }),
    "trust-tag-category": storedFileFor({ kind: "trust-tag-category" }),
    user: storedFileFor({ kind: "user" }),
    vendor: storedFileFor({ kind: "vendor" }),
    "vendor-assessment-type": storedFileFor({ kind: "vendor-assessment-type" }),
    "vendor-risk-attribute": storedFileFor({ kind: "vendor-risk-attribute" }),
    vulnerability: storedFileFor({ kind: "vulnerability" }),
    "vulnerability-remediation": storedFileFor({ kind: "vulnerability-remediation" }),
    "vulnerable-asset": storedFileFor({ kind: "vulnerable-asset" }),
  };
}
