/*
 * The three kind files the API-surface sync publishes, built over a real empty generation: the four `method`
 * cells this sync owns, in order, and a refused call turning only its own kind's cell `deferred`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  apiKindFiles,
  TRELICA_PUBLISHED_DATA_SURFACE,
  TRELICA_PUBLISHED_SURFACE,
  TRELICA_VOLUMINOUS_SURFACE,
  type TrelicaMergedChannels,
} from "../../../../atlas/trelica/apiKindFiles.js";
import { TrelicaAtlasErrors } from "../../../../atlas/trelica/errors.js";
import type { TrelicaFirstPartyRun } from "../../../../atlas/trelica/firstPartyRun.js";
import { TRELICA_CALLS } from "../../../../atlas/trelica/inventory.js";
import { storedTrelicaKindFile, TRELICA_FIRST_PARTY_SURFACE } from "../../../../atlas/trelica/kindFiles.js";
import type { TrelicaAtlasGap } from "../../../../atlas/trelica/model.js";
import type { TrelicaPublishedSurface } from "../../../../atlas/trelica/publishedSpec.js";
import { readTrelicaAtlas, type TrelicaAtlasSnapshot, trelicaAtlasPaths } from "../../../../atlas/trelica/store.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A generation nobody has published into yet, read through the real store. */
function emptySnapshot(): TrelicaAtlasSnapshot {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-trelica-api-kind-files-"));
  homes.push(home);
  return unwrap(readTrelicaAtlas({ paths: trelicaAtlasPaths({ home }) }));
}

const SURFACE: TrelicaPublishedSurface = { documents: [], unreadable: [] };
const MERGED: TrelicaMergedChannels = {
  apps: [],
  freshApps: 0,
  freshRoles: 0,
  methods: [],
  publishedMethods: 0,
  roles: [],
};
const NO_GAPS: readonly TrelicaAtlasGap[] = [];

/** A first-party run in which every call answered with nothing. */
function quietRun(): TrelicaFirstPartyRun {
  return {
    entities: { calls: [], reads: [], steps: { firstFailure: null, read: 0, reused: 0, unread: 0 } },
    failures: [],
    results: [],
    usage: [],
    window: { endDate: "2026-09-05", startDate: "2024-09-06" },
  };
}

/** Build the three files over an empty generation for one run. */
function filesFor({ run }: { run: TrelicaFirstPartyRun }): ReturnType<typeof apiKindFiles> {
  const snapshot = emptySnapshot();
  return apiKindFiles({
    at: AT,
    gaps: NO_GAPS,
    merged: MERGED,
    run,
    snapshot,
    storedMethods: storedTrelicaKindFile({ at: AT, kind: "method", snapshot }),
    surface: SURFACE,
  });
}

describe("apiKindFiles", () => {
  it("writes the four method cells this sync owns, in order", () => {
    const { methodFile } = filesFor({ run: quietRun() });
    expect(methodFile.coverage.map((cell) => [cell.surface, cell.state])).toEqual([
      [TRELICA_PUBLISHED_SURFACE, "synced"],
      [TRELICA_PUBLISHED_DATA_SURFACE, "not-configured"],
      [TRELICA_FIRST_PARTY_SURFACE, "synced"],
      [TRELICA_VOLUMINOUS_SURFACE, "excluded"],
    ]);
    expect(methodFile.updatedAt).toBe(AT);
  });

  it("defers only the role file's cell when the roles call was refused", () => {
    const run: TrelicaFirstPartyRun = {
      ...quietRun(),
      failures: [
        {
          callId: TRELICA_CALLS.roles.id,
          error: TrelicaAtlasErrors.callRefused({ callId: "roles", statusCode: 403 }),
        },
      ],
    };
    const { appFile, roleFile } = filesFor({ run });
    expect(roleFile.coverage.map((cell) => [cell.surface, cell.state])).toEqual([
      [TRELICA_FIRST_PARTY_SURFACE, "deferred"],
    ]);
    expect(appFile.coverage.map((cell) => [cell.surface, cell.state])).toEqual([
      [TRELICA_FIRST_PARTY_SURFACE, "synced"],
    ]);
  });
});
