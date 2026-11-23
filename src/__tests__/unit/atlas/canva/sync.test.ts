/**
 * What one compiled generation actually contains, built in memory with no filesystem at all.
 *
 * `buildCanvaGeneration` is separated from the publish for exactly this: every judgement in the sync is
 * pure, so the shape of a generation is testable without a temp directory, and the only untested thing left
 * is the kit's own write protocol — which has its own tests.
 */
import { describe, expect, it } from "vitest";

import { CANVA_SCOPES, CANVA_SURFACES } from "../../../../atlas/canva/generated/surfaces.js";
import { CANVA_ATLAS_KINDS } from "../../../../atlas/canva/model.js";
import { buildCanvaGeneration } from "../../../../atlas/canva/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-06T00:00:00.000Z";

describe("buildCanvaGeneration", () => {
  it("publishes one file per declared kind, so no kind is silently absent", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    expect(Object.keys(files).toSorted()).toStrictEqual([...CANVA_ATLAS_KINDS].toSorted());
  });

  it("publishes every operation and every scope, and nothing else", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const entities = CANVA_ATLAS_KINDS.flatMap((kind) => files[kind].entities);
    expect(entities.length).toBe(CANVA_SURFACES.length + CANVA_SCOPES.length);
    expect(entities.filter((entity) => entity.family === "operation").length).toBe(59);
    expect(entities.filter((entity) => entity.family === "scope").length).toBe(18);
  });

  it("fills only the compiled channel on every entity, because the other two are unreachable here", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const claiming = CANVA_ATLAS_KINDS.flatMap((kind) => files[kind].entities).filter(
      (entity) => entity.channels["connect-api"] !== null || entity.channels["web-app"] !== null,
    );
    expect(claiming.map((entity) => entity.providerId)).toStrictEqual([]);
  });

  it("gives every kind three coverage cells — one synced, two not-configured", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    for (const kind of CANVA_ATLAS_KINDS) {
      const states = files[kind].coverage.map((cell) => `${cell.channel}=${cell.state}`);
      expect(states).toStrictEqual(["published-api=synced", "connect-api=not-configured", "web-app=not-configured"]);
    }
  });

  it("names a concrete act for each unfilled channel, and the two acts are different", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const cells = files.design.coverage;
    expect(cells[1]!.unblockedBy).toContain("canva.com/developers");
    expect(cells[2]!.unblockedBy).toContain("NOT blocked on the owner");
  });

  it("raises the credential gap on every kind, so a reader of one kind's file sees it", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const missing = CANVA_ATLAS_KINDS.filter(
      (kind) => !files[kind].gaps.some((gap) => gap.condition === "no-integration-credential"),
    );
    expect(missing).toStrictEqual([]);
  });

  it("raises the browser gap and the unused-tag gap on the page kind, and nowhere else", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const elsewhere = CANVA_ATLAS_KINDS.filter(
      (kind) =>
        kind !== "page" &&
        files[kind].gaps.some((gap) => gap.condition === "no-web-app-walk" || gap.condition === "declared-unused-tag"),
    );
    expect(elsewhere).toStrictEqual([]);
    expect(files.page.gaps.map((gap) => gap.condition).toSorted()).toStrictEqual([
      "declared-unused-tag",
      "no-integration-credential",
      "no-web-app-walk",
    ]);
  });

  it("says the browser surface waits on the walk rather than on a sign-in, with a positive count that proves it", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const gap = files.page.gaps.find((candidate) => candidate.condition === "no-web-app-walk")!;
    expect(gap.reason).toMatch(
      /`slopweaver browser cookies --origin https:\/\/www\.canva\.com` reports [1-9]\d* cookies in the owner's own Chrome profile/,
    );
    expect(gap.surfaces).toStrictEqual(["web-app"]);
  });

  it("raises a grantable-uncallable-scope gap on exactly the two kinds that own an unspent scope", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const raised = CANVA_ATLAS_KINDS.filter((kind) =>
      files[kind].gaps.some((gap) => gap.condition === "grantable-uncallable-scope"),
    );
    expect([...raised].toSorted()).toStrictEqual(["connect", "folder"]);
    const folder = files.folder.gaps.find((gap) => gap.condition === "grantable-uncallable-scope")!;
    expect(folder.fields).toStrictEqual(["folder:permission:write"]);
  });

  it("raises the vendor's own eligibility disagreement on the autofill kind", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const gap = files.autofill.gaps.find((candidate) => candidate.condition === "undeclared-entitlement")!;
    expect(gap.fields).toStrictEqual(["createDesignAutofillJob", "getDesignAutofillJob"]);
  });

  it("raises browser-only-capability on the two kinds the vendor sends to the UI, naming the operations", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const raised = CANVA_ATLAS_KINDS.filter((kind) =>
      files[kind].gaps.some((gap) => gap.condition === "browser-only-capability"),
    );
    expect([...raised].toSorted()).toStrictEqual(["folder", "resize"]);
    expect(files.resize.gaps.find((gap) => gap.condition === "browser-only-capability")!.fields).toStrictEqual([
      "createDesignResizeJob",
    ]);
  });

  it("quotes the vendor about the kind the gap is FILED under, never about the other one", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    const folder = files.folder.gaps.find((gap) => gap.condition === "browser-only-capability")!;
    const resize = files.resize.gaps.find((gap) => gap.condition === "browser-only-capability")!;
    expect(folder.reason).toContain("item_in_multiple_folders");
    expect(folder.reason.includes("In-place resizing")).toBe(false);
    expect(resize.reason).toContain("In-place resizing");
    expect(resize.reason.includes("item_in_multiple_folders")).toBe(false);
  });

  it("carries twenty-four gaps in total", () => {
    const { files } = unwrap(buildCanvaGeneration({ at: AT }));
    expect(CANVA_ATLAS_KINDS.reduce((total, kind) => total + files[kind].gaps.length, 0)).toBe(24);
  });

  it("writes byte-identical files for two runs given the same instant, so a real diff is readable", () => {
    const first = unwrap(buildCanvaGeneration({ at: AT }));
    const second = unwrap(buildCanvaGeneration({ at: AT }));
    expect(JSON.stringify(second.files)).toBe(JSON.stringify(first.files));
  });

  it("counts in the manifest exactly what each kind's file holds", () => {
    const { files, manifest } = unwrap(buildCanvaGeneration({ at: AT }));
    const disagreeing = CANVA_ATLAS_KINDS.filter(
      (kind) => manifest.kinds[kind].entityCount !== files[kind].entities.length,
    );
    expect(disagreeing).toStrictEqual([]);
    expect(manifest.kinds.page.entityCount).toBe(0);
  });
});
