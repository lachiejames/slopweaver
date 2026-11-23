import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyVantaKindFile, initialVantaManifest } from "../../../../atlas/vanta/model.js";
import { resetVantaAtlas } from "../../../../atlas/vanta/reset.js";
import { publishVantaAtlas, readVantaAtlas, vantaAtlasPaths } from "../../../../atlas/vanta/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("resetVantaAtlas", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-reset-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses when there is no current atlas to reset", () => {
    const paths = vantaAtlasPaths({ home });
    const result = resetVantaAtlas({ at: AT, paths });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("nothing to reset");
  });

  it("archives the current generation and installs a fresh, empty one", () => {
    const paths = vantaAtlasPaths({ home });
    publishVantaAtlas({
      derivedFrom: null,
      files: { control: emptyVantaKindFile({ kind: "control", updatedAt: AT }) },
      manifest: initialVantaManifest({ updatedAt: AT }),
      paths,
    });

    const outcome = unwrap(resetVantaAtlas({ at: AT, paths }));
    expect(existsSync(outcome.archivedTo)).toBe(true);

    const snapshot = unwrap(readVantaAtlas({ paths }));
    expect(snapshot.files.control!.entities).toEqual([]);
    // A freshly-installed empty generation is never-synced by construction (every kind's manifest status
    // has lastSuccessAt: null), so every kind file on disk reads as "unpublished" until a real sync runs —
    // that is `readVantaAtlas`'s own honest grading, not a defect of reset.
    expect(snapshot.unpublished.toSorted()).toEqual([
      "answer-library-entry",
      "audit",
      "browser-operation",
      "browser-page",
      "control",
      "control-document-link",
      "customer-trust-account",
      "discovered-vendor",
      "discovered-vendor-account",
      "document-link",
      "document-upload",
      "event-shape",
      "evidence",
      "framework",
      "framework-control-link",
      "group",
      "group-member",
      "importable-idp-group",
      "integration",
      "integration-resource",
      "integration-resource-kind",
      "issue",
      "library-control",
      "monitored-computer",
      "person",
      "policy",
      "policy-document",
      "questionnaire",
      "questionnaire-assignable-user",
      "risk",
      "risk-control-link",
      "test",
      "trust-tag-category",
      "user",
      "vendor",
      "vendor-assessment",
      "vendor-assessment-type",
      "vendor-document",
      "vendor-risk-attribute",
      "vendor-security-review",
      "vulnerability",
      "vulnerability-remediation",
      "vulnerable-asset",
    ]);
  });

  it("refuses rather than overwrites an archive that already exists at the same instant", () => {
    const paths = vantaAtlasPaths({ home });
    publishVantaAtlas({ derivedFrom: null, files: {}, manifest: initialVantaManifest({ updatedAt: AT }), paths });
    resetVantaAtlas({ at: AT, paths });
    // The freshly-installed empty generation exists again, so a second reset at the SAME instant would
    // collide with the archive the first reset just created.
    const result = resetVantaAtlas({ at: AT, paths });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("already exists");
  });
});
