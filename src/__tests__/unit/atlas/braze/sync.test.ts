/**
 * `buildKindFiles` over two kinds, each firing a different reviewed rule, so a kind judged against its own
 * rows instead of the whole run's calls the other kind's rule dead; where `indexOperations` lands a collection
 * row; and what the declared-route gaps say about where each route is.
 *
 * The store is read from an empty temp home, which is the generation a first sync starts from.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrazeCollectionOperationRow } from "../../../../atlas/braze/collection.js";
import { brazeDispositionRuleIds } from "../../../../atlas/braze/dispositions.js";
import type { BrazeDocsOperationRow } from "../../../../atlas/braze/docsCatalogue.js";
import type { BrazeAtlasKindFile, BrazeKind } from "../../../../atlas/braze/model.js";
import { brazeAtlasPaths, readBrazeAtlas } from "../../../../atlas/braze/store.js";
import { buildKindFiles, indexOperations } from "../../../../atlas/braze/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";

const REVIEWED = brazeDispositionRuleIds();
const FIRED_IN_EMAIL = REVIEWED[0]!;
const FIRED_IN_SMS = REVIEWED[1]!;

/** One documented operation in `kind`, classified by `ruleId`, with every other field distinct to it. */
function docsRow({
  kind,
  providerId,
  ruleId,
}: {
  kind: BrazeKind;
  providerId: string;
  ruleId: string;
}): BrazeDocsOperationRow {
  return {
    disposition: "reachable",
    dispositionReason: `reviewed ${providerId}`,
    dispositionRuleId: ruleId,
    kind,
    lastModified: AT,
    method: providerId.split(" ")[0]!,
    parameters: [],
    pathDefect: null,
    pathShape: providerId.split(" ")[1]!,
    providerId,
    rateLimit: null,
    responseFields: [],
    title: `Docs title for ${providerId}`,
    url: `https://www.braze.com/docs/${providerId}`,
  };
}

let home: string | undefined;

afterEach(() => {
  if (home !== undefined) {
    rmSync(home, { force: true, recursive: true });
    home = undefined;
  }
});

/** The dead-rule gap scopes one kind's next file carries, sorted. */
function deadRuleScopes({
  files,
  kind,
}: {
  files: Partial<Record<BrazeKind, BrazeAtlasKindFile>>;
  kind: BrazeKind;
}): readonly string[] {
  return files[kind]!.gaps.filter((gap) => gap.condition === "disposition-rule-never-fired")
    .map((gap) => gap.scope)
    .toSorted();
}

describe("buildKindFiles", () => {
  it("judges each kind's dead rules against the whole run's rows, not its own", () => {
    expect(REVIEWED.length).toBeGreaterThan(2);
    home = mkdtempSync(join(tmpdir(), "braze-sync-"));
    const snapshot = unwrap(readBrazeAtlas({ paths: brazeAtlasPaths({ home }) }));
    const index = indexOperations({
      collection: { duplicates: [], requestCount: 0, rows: [] },
      docs: {
        declaredPages: 2,
        fetched: 2,
        fromCache: 0,
        rows: [
          docsRow({ kind: "email", providerId: "POST /email/fired", ruleId: FIRED_IN_EMAIL }),
          docsRow({ kind: "sms", providerId: "GET /sms/fired", ruleId: FIRED_IN_SMS }),
        ],
        unservedPages: [],
      },
    });

    const { files } = unwrap(buildKindFiles({ at: AT, index, snapshot }));

    const stillDead = REVIEWED.slice(2).toSorted();
    expect(deadRuleScopes({ files, kind: "email" })).toEqual(stillDead);
    expect(deadRuleScopes({ files, kind: "sms" })).toEqual(stillDead);
  });

  it("lands a collection operation in its documented kind, and one the reference omits in undocumented", () => {
    home = mkdtempSync(join(tmpdir(), "braze-sync-"));
    const snapshot = unwrap(readBrazeAtlas({ paths: brazeAtlasPaths({ home }) }));
    const index = indexOperations({
      collection: {
        duplicates: [],
        requestCount: 2,
        rows: [
          collectionRow({ providerId: "POST /email/fired", ruleId: FIRED_IN_EMAIL }),
          collectionRow({ providerId: "GET /only/collection", ruleId: FIRED_IN_SMS }),
        ],
      },
      docs: {
        declaredPages: 1,
        fetched: 1,
        fromCache: 0,
        rows: [docsRow({ kind: "email", providerId: "POST /email/fired", ruleId: FIRED_IN_EMAIL })],
        unservedPages: [],
      },
    });

    expect(index.collectionRows.map(({ kind, row }) => `${kind} ${row.providerId}`)).toEqual([
      "email POST /email/fired",
      "undocumented GET /only/collection",
    ]);
    expect(index.collectionOnly.map((row) => row.providerId)).toEqual(["GET /only/collection"]);
    const { files } = unwrap(buildKindFiles({ at: AT, index, snapshot }));
    expect(providerIdsOf({ files, kind: "email" })).toEqual(["POST /email/fired"]);
    expect(providerIdsOf({ files, kind: "undocumented" })).toEqual(["GET /only/collection"]);
    expect(providerIdsOf({ files, kind: "sms" })).toEqual([]);
  });

  it("says where each declared route is, or that Braze publishes no URL for it", () => {
    home = mkdtempSync(join(tmpdir(), "braze-sync-"));
    const snapshot = unwrap(readBrazeAtlas({ paths: brazeAtlasPaths({ home }) }));
    const index = indexOperations({
      collection: { duplicates: [], requestCount: 0, rows: [] },
      docs: { declaredPages: 0, fetched: 0, fromCache: 0, rows: [], unservedPages: [] },
    });

    const { files } = unwrap(buildKindFiles({ at: AT, index, snapshot }));
    const reasonFor = ({ scope }: { scope: string }): string =>
      files.page!.gaps.find((gap) => gap.scope === scope)!.reason;
    expect(reasonFor({ scope: "dashboard-sign-in" })).toContain("(https://dashboard.braze.com/sign_in)");
    expect(reasonFor({ scope: "settings-api-keys" })).toContain(
      "(no URL published by Braze — a walk must discover it)",
    );
  });
});

/** The provider ids one kind's next file holds, sorted. */
function providerIdsOf({
  files,
  kind,
}: {
  files: Partial<Record<BrazeKind, BrazeAtlasKindFile>>;
  kind: BrazeKind;
}): readonly string[] {
  return files[kind]!.entities.map((entity) => entity.providerId).toSorted();
}

/** One collection request, classified by `ruleId`, with every other field distinct to it. */
function collectionRow({ providerId, ruleId }: { providerId: string; ruleId: string }): BrazeCollectionOperationRow {
  return {
    disposition: "reachable",
    dispositionReason: `reviewed ${providerId}`,
    dispositionRuleId: ruleId,
    folders: ["Folder"],
    headers: [],
    method: providerId.split(" ")[0]!,
    name: `Request ${providerId}`,
    pathDefect: null,
    pathShape: providerId.split(" ")[1]!,
    providerId,
    queryParams: [],
    requestBodyFields: [],
  };
}
