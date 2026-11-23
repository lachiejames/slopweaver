/**
 * `vanta reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is Vanta's own is
 * only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/vanta/`.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyVantaKindFile, initialVantaManifest, type VantaKind, type VantaKindFile } from "./model.js";
import { VANTA_STORE_SPEC, type VantaAtlasPaths } from "./store.js";

/** What a reset did. */
export type VantaResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyVantaFiles({ at }: { at: string }): Readonly<Record<VantaKind, VantaKindFile>> {
  return {
    "answer-library-entry": emptyVantaKindFile({ kind: "answer-library-entry", updatedAt: at }),
    "customer-trust-account": emptyVantaKindFile({ kind: "customer-trust-account", updatedAt: at }),
    "importable-idp-group": emptyVantaKindFile({ kind: "importable-idp-group", updatedAt: at }),
    "library-control": emptyVantaKindFile({ kind: "library-control", updatedAt: at }),
    questionnaire: emptyVantaKindFile({ kind: "questionnaire", updatedAt: at }),
    "questionnaire-assignable-user": emptyVantaKindFile({ kind: "questionnaire-assignable-user", updatedAt: at }),
    "trust-tag-category": emptyVantaKindFile({ kind: "trust-tag-category", updatedAt: at }),
    "vulnerability-remediation": emptyVantaKindFile({ kind: "vulnerability-remediation", updatedAt: at }),
    "control-document-link": emptyVantaKindFile({ kind: "control-document-link", updatedAt: at }),
    "discovered-vendor-account": emptyVantaKindFile({ kind: "discovered-vendor-account", updatedAt: at }),
    "document-link": emptyVantaKindFile({ kind: "document-link", updatedAt: at }),
    "document-upload": emptyVantaKindFile({ kind: "document-upload", updatedAt: at }),
    "framework-control-link": emptyVantaKindFile({ kind: "framework-control-link", updatedAt: at }),
    "group-member": emptyVantaKindFile({ kind: "group-member", updatedAt: at }),
    "integration-resource": emptyVantaKindFile({ kind: "integration-resource", updatedAt: at }),
    "integration-resource-kind": emptyVantaKindFile({ kind: "integration-resource-kind", updatedAt: at }),
    "risk-control-link": emptyVantaKindFile({ kind: "risk-control-link", updatedAt: at }),
    "vendor-assessment": emptyVantaKindFile({ kind: "vendor-assessment", updatedAt: at }),
    "vendor-document": emptyVantaKindFile({ kind: "vendor-document", updatedAt: at }),
    "vendor-security-review": emptyVantaKindFile({ kind: "vendor-security-review", updatedAt: at }),
    audit: emptyVantaKindFile({ kind: "audit", updatedAt: at }),
    "browser-operation": emptyVantaKindFile({ kind: "browser-operation", updatedAt: at }),
    "browser-page": emptyVantaKindFile({ kind: "browser-page", updatedAt: at }),
    control: emptyVantaKindFile({ kind: "control", updatedAt: at }),
    "discovered-vendor": emptyVantaKindFile({ kind: "discovered-vendor", updatedAt: at }),
    evidence: emptyVantaKindFile({ kind: "evidence", updatedAt: at }),
    "event-shape": emptyVantaKindFile({ kind: "event-shape", updatedAt: at }),
    framework: emptyVantaKindFile({ kind: "framework", updatedAt: at }),
    group: emptyVantaKindFile({ kind: "group", updatedAt: at }),
    integration: emptyVantaKindFile({ kind: "integration", updatedAt: at }),
    issue: emptyVantaKindFile({ kind: "issue", updatedAt: at }),
    "monitored-computer": emptyVantaKindFile({ kind: "monitored-computer", updatedAt: at }),
    person: emptyVantaKindFile({ kind: "person", updatedAt: at }),
    policy: emptyVantaKindFile({ kind: "policy", updatedAt: at }),
    "policy-document": emptyVantaKindFile({ kind: "policy-document", updatedAt: at }),
    risk: emptyVantaKindFile({ kind: "risk", updatedAt: at }),
    test: emptyVantaKindFile({ kind: "test", updatedAt: at }),
    user: emptyVantaKindFile({ kind: "user", updatedAt: at }),
    vendor: emptyVantaKindFile({ kind: "vendor", updatedAt: at }),
    "vendor-assessment-type": emptyVantaKindFile({ kind: "vendor-assessment-type", updatedAt: at }),
    "vendor-risk-attribute": emptyVantaKindFile({ kind: "vendor-risk-attribute", updatedAt: at }),
    vulnerability: emptyVantaKindFile({ kind: "vulnerability", updatedAt: at }),
    "vulnerable-asset": emptyVantaKindFile({ kind: "vulnerable-asset", updatedAt: at }),
  };
}

/**
 * Archive the current Vanta atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetVantaAtlas({ paths, at }: { paths: VantaAtlasPaths; at: string }): Result<VantaResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyVantaFiles({ at }),
    emptyManifest: initialVantaManifest({ updatedAt: at }),
    paths,
    spec: VANTA_STORE_SPEC,
  });
}
