import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetNotionAtlas } from "../../../../atlas/notion/reset.js";
import { type NotionAtlasPaths, notionAtlasPaths, readNotionKindFile } from "../../../../atlas/notion/store.js";
import { syncNotionApiSurface } from "../../../../atlas/notion/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";

let home: string;
let paths: NotionAtlasPaths;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-notion-reset-"));
  paths = notionAtlasPaths({ home });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("resetNotionAtlas", () => {
  it("leaves the prior generation on disk rather than deleting it", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const outcome = unwrap(resetNotionAtlas({ at: AT, paths }));
    expect(existsSync(outcome.archivedTo)).toBe(true);
  });

  it("installs an empty generation for every kind, so what is current is complete", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    unwrap(resetNotionAtlas({ at: AT, paths }));
    expect(unwrap(readNotionKindFile({ kind: "page", paths }))!.entities).toEqual([]);
  });

  it("empties the method kind the sync had filled", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    unwrap(resetNotionAtlas({ at: AT, paths }));
    expect(unwrap(readNotionKindFile({ kind: "method", paths }))!.entities).toEqual([]);
  });

  it("leaves the atlas readable again straight afterwards", () => {
    const before = unwrap(syncNotionApiSurface({ at: AT, paths }));
    unwrap(resetNotionAtlas({ at: AT, paths }));
    // Not a literal: the installed `@notionhq/client` decides this count, and pinning it made the test fail
    // on a routine SDK bump rather than on anything about reset. What matters here is that a sync after a
    // reset republishes the same surface the first one did.
    expect(unwrap(syncNotionApiSurface({ at: AT, paths })).endpointCount).toBe(before.endpointCount);
  });
});
