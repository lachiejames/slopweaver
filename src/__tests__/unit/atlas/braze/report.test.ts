/**
 * `reportBrazeDisagreements` over a real published generation, plus its two small helpers.
 *
 * The store is written through `publishBrazeAtlas`, so the report reads exactly what a sync leaves behind.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BrazeAtlasErrors, brazeAtlasErrorLines } from "../../../../atlas/braze/errors.js";
import { BRAZE_GAP_CONDITIONS, type BrazeGapCondition, openBrazeGap } from "../../../../atlas/braze/gaps.js";
import {
  BRAZE_KINDS,
  type BrazeAtlasEntity,
  type BrazeAtlasGap,
  type BrazeAtlasKindFile,
  type BrazeKind,
  emptyBrazeKindFile,
  initialBrazeManifest,
} from "../../../../atlas/braze/model.js";
import {
  brazeItemisedGapCount,
  isBrazeDisagreementGap,
  reportBrazeDisagreements,
} from "../../../../atlas/braze/report.js";
import { brazeAtlasPaths, publishBrazeAtlas } from "../../../../atlas/braze/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home, so nothing here touches the ambient one. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "braze-report-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** One stored entity with no channel filled; the report only counts entities per kind. */
function entityOf({ kind, ordinal }: { kind: BrazeKind; ordinal: number }): BrazeAtlasEntity {
  return {
    channels: { api: null, browser: null, collection: null, docs: null },
    id: `id-${kind}-${String(ordinal)}`,
    kind,
    providerId: `GET /${kind}/${String(ordinal)}`,
  };
}

/** An open gap on one kind, its reason naming its scope. */
function gapOf({
  condition,
  kind,
  scope,
}: {
  condition: BrazeGapCondition;
  kind: BrazeKind;
  scope: string;
}): BrazeAtlasGap {
  return openBrazeGap({ at: AT, condition, fields: [], kind, reason: `reason ${scope}`, scope, surfaces: [] });
}

/** A kind file holding `count` entities and the given gaps. */
function fileOf({
  kind,
  count,
  gaps,
}: {
  kind: BrazeKind;
  count: number;
  gaps: readonly BrazeAtlasGap[];
}): BrazeAtlasKindFile {
  const entities = Array.from({ length: count }, (_, index) => entityOf({ kind, ordinal: index + 1 }));
  return { ...emptyBrazeKindFile({ kind, updatedAt: AT }), entities, gaps: [...gaps] };
}

const MISSING = "collection-missing-documented-operation";

/** The kind files the full fixture publishes; every other kind is published empty. */
function fixtureFiles(): Partial<Record<BrazeKind, BrazeAtlasKindFile>> {
  const closed: BrazeAtlasGap = {
    ...gapOf({ condition: MISSING, kind: "templates", scope: "GET /templates/closed" }),
    status: "closed",
  };
  return {
    data_objects: fileOf({
      count: 3,
      gaps: ["GET /d/3", "GET /d/1", "GET /d/2"].map((scope) =>
        gapOf({ condition: MISSING, kind: "data_objects", scope }),
      ),
      kind: "data_objects",
    }),
    email: fileOf({
      count: 2,
      gaps: [
        gapOf({ condition: MISSING, kind: "email", scope: "POST /email/b" }),
        gapOf({ condition: MISSING, kind: "email", scope: "GET /email/a" }),
        gapOf({ condition: "documentation-missing-collection-operation", kind: "email", scope: "GET /email/z" }),
        gapOf({ condition: "rest-credential-absent", kind: "email", scope: "email" }),
      ],
      kind: "email",
    }),
    sms: fileOf({
      count: 3,
      gaps: [
        gapOf({ condition: MISSING, kind: "sms", scope: "GET /sms/x" }),
        gapOf({ condition: "rest-credential-absent", kind: "sms", scope: "sms" }),
        gapOf({ condition: "published-census-moved", kind: "sms", scope: "sms-census" }),
        gapOf({ condition: "browser-account-absent", kind: "sms", scope: "sms-browser" }),
      ],
      kind: "sms",
    }),
    templates: fileOf({
      count: 1,
      gaps: [closed, gapOf({ condition: "published-path-malformed", kind: "templates", scope: "GET /templates/{bad" })],
      kind: "templates",
    }),
    translations: fileOf({
      count: 2,
      gaps: ["GET /t/2", "GET /t/1"].map((scope) => gapOf({ condition: MISSING, kind: "translations", scope })),
      kind: "translations",
    }),
  };
}

/** Publish the fixture into a fresh home and return its paths. */
function publishedPaths(): ReturnType<typeof brazeAtlasPaths> {
  const paths = brazeAtlasPaths({ home: freshHome() });
  const files: Partial<Record<BrazeKind, BrazeAtlasKindFile>> = {};
  for (const kind of BRAZE_KINDS) {
    files[kind] = emptyBrazeKindFile({ kind, updatedAt: AT });
  }
  Object.assign(files, fixtureFiles());
  unwrap(publishBrazeAtlas({ derivedFrom: null, files, manifest: initialBrazeManifest({ updatedAt: AT }), paths }));
  return paths;
}

/** One itemised disagreement row as the report shapes it. */
function row({ kind, providerId }: { kind: BrazeKind; providerId: string }): {
  kind: BrazeKind;
  providerId: string;
  reason: string;
} {
  return { kind, providerId, reason: `reason ${providerId}` };
}

describe("reportBrazeDisagreements over a published generation", () => {
  it("itemises the three conditions sorted by provider id, counts the rest, and ignores a closed gap", () => {
    const report = unwrap(reportBrazeDisagreements({ paths: publishedPaths() }));

    expect(report).toEqual({
      familiesAbsentFromCollection: [
        { kind: "data_objects", operations: 3 },
        { kind: "email", operations: 2 },
        { kind: "translations", operations: 2 },
      ],
      malformedPaths: [row({ kind: "templates", providerId: "GET /templates/{bad" })],
      missingFromCollection: [
        row({ kind: "data_objects", providerId: "GET /d/1" }),
        row({ kind: "data_objects", providerId: "GET /d/2" }),
        row({ kind: "data_objects", providerId: "GET /d/3" }),
        row({ kind: "email", providerId: "GET /email/a" }),
        row({ kind: "sms", providerId: "GET /sms/x" }),
        row({ kind: "translations", providerId: "GET /t/1" }),
        row({ kind: "translations", providerId: "GET /t/2" }),
        row({ kind: "email", providerId: "POST /email/b" }),
      ],
      missingFromDocumentation: [row({ kind: "email", providerId: "GET /email/z" })],
      otherOpenGaps: [
        { condition: "rest-credential-absent", count: 2 },
        { condition: "browser-account-absent", count: 1 },
        { condition: "published-census-moved", count: 1 },
      ],
    });
  });

  it("totals only the itemised disagreements", () => {
    const report = unwrap(reportBrazeDisagreements({ paths: publishedPaths() }));

    expect(brazeItemisedGapCount({ report })).toBe(10);
  });
});

describe("reportBrazeDisagreements with nothing published", () => {
  it("refuses with the nothing-published error's lines", () => {
    const error = unwrapErr(reportBrazeDisagreements({ paths: brazeAtlasPaths({ home: freshHome() }) }));

    expect(error).toEqual(brazeAtlasErrorLines({ error: BrazeAtlasErrors.nothingPublished() }));
  });

  it("refuses with the literal nothing-published lines, the remedy second", () => {
    const error = unwrapErr(reportBrazeDisagreements({ paths: brazeAtlasPaths({ home: freshHome() }) }));

    expect(error).toEqual([
      "no generation has been published, so there is nothing to compare",
      "run: slopweaver atlas braze sync — it needs no credential",
    ]);
  });
});

describe("isBrazeDisagreementGap", () => {
  it("accepts exactly the three itemised conditions out of every declared condition", () => {
    expect(BRAZE_GAP_CONDITIONS.length).toBeGreaterThan(3);
    const accepted = BRAZE_GAP_CONDITIONS.filter((condition) =>
      isBrazeDisagreementGap({ gap: gapOf({ condition, kind: "email", scope: "s" }) }),
    );

    expect(accepted).toEqual([
      "published-path-malformed",
      "collection-missing-documented-operation",
      "documentation-missing-collection-operation",
    ]);
  });
});
