import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { succeededMicrosoft365CoverageCell } from "../../../../atlas/microsoft365/coverage.js";
import { openMicrosoft365Gap } from "../../../../atlas/microsoft365/gaps.js";
import {
  emptyMicrosoft365KindFile,
  initialMicrosoft365Manifest,
  type Microsoft365AtlasKindFile,
} from "../../../../atlas/microsoft365/model.js";
import { projectMicrosoft365Operation } from "../../../../atlas/microsoft365/projection.js";
import { readMicrosoft365Snapshot } from "../../../../atlas/microsoft365/readAdapter.js";
import { resetMicrosoft365Atlas } from "../../../../atlas/microsoft365/reset.js";
import {
  microsoft365AtlasPaths,
  publishMicrosoft365Atlas,
  readMicrosoft365Atlas,
  readMicrosoft365Manifest,
} from "../../../../atlas/microsoft365/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const LATER = "2026-09-06T00:00:00.000Z";
const homes: string[] = [];

/** A scratch home, removed in `afterEach`. Every write below names it explicitly. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-m365-store-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** One `users` kind file holding a single operation, a coverage cell and a gap. */
function usersFile(): Microsoft365AtlasKindFile {
  return {
    ...emptyMicrosoft365KindFile({ kind: "users", updatedAt: AT }),
    coverage: [
      succeededMicrosoft365CoverageCell({
        artifacts: [],
        at: AT,
        channel: "compiled",
        reason: "1 operation compiled",
        role: "authoritative",
        scope: "graph-v1.0-operations",
        state: "synced",
        surface: "graph-specification",
      }),
    ],
    entities: [
      projectMicrosoft365Operation({
        at: AT,
        row: {
          aliasOf: null,
          disposition: "reachable",
          dispositionReason: "identity or configuration",
          dispositionRuleId: "configuration-default",
          kind: "users",
          method: "GET",
          operationId: "users.user.ListUser",
          pagination: "odata-top-skip",
          pathParams: [],
          pathShape: "/users",
          providerId: "GET /users",
          queryParams: ["$top"],
          responseFields: ["id"],
          responseSchema: "microsoft.graph.user",
          summary: "List users",
          tags: ["users.user"],
        },
      }),
    ],
    gaps: [
      openMicrosoft365Gap({
        at: AT,
        condition: "graph-credential-absent",
        fields: [],
        kind: "users",
        reason: "nothing has asked this tenant for any of it",
        scope: "users",
        surfaces: ["api"],
      }),
    ],
  };
}

describe("the microsoft365 atlas store", () => {
  it("publishes a generation and reads back exactly what it wrote", () => {
    const paths = microsoft365AtlasPaths({ home: scratchHome() });
    unwrap(
      publishMicrosoft365Atlas({
        derivedFrom: null,
        files: { users: usersFile() },
        manifest: initialMicrosoft365Manifest({ updatedAt: AT }),
        paths,
      }),
    );
    const snapshot = unwrap(readMicrosoft365Atlas({ paths }));
    expect(snapshot.files.users?.entities.length).toBe(1);
    expect(snapshot.files.users?.entities[0]?.providerId).toBe("GET /users");
    expect(snapshot.files.users?.gaps[0]?.condition).toBe("graph-credential-absent");
  });

  it("leaves a kind the publish omitted exactly as it was", () => {
    const paths = microsoft365AtlasPaths({ home: scratchHome() });
    const manifest = initialMicrosoft365Manifest({ updatedAt: AT });
    unwrap(publishMicrosoft365Atlas({ derivedFrom: null, files: { users: usersFile() }, manifest, paths }));
    unwrap(
      publishMicrosoft365Atlas({
        derivedFrom: unwrap(readMicrosoft365Manifest({ paths })),
        files: { groups: emptyMicrosoft365KindFile({ kind: "groups", updatedAt: LATER }) },
        manifest: { ...manifest, updatedAt: LATER },
        paths,
      }),
    );
    expect(unwrap(readMicrosoft365Atlas({ paths })).files.users?.entities.length).toBe(1);
  });

  it("refuses a publish derived from a generation another writer has replaced", () => {
    const paths = microsoft365AtlasPaths({ home: scratchHome() });
    unwrap(
      publishMicrosoft365Atlas({
        derivedFrom: null,
        files: { users: usersFile() },
        manifest: initialMicrosoft365Manifest({ updatedAt: AT }),
        paths,
      }),
    );

    const refused = unwrapErr(
      publishMicrosoft365Atlas({
        derivedFrom: null,
        files: { users: usersFile() },
        manifest: initialMicrosoft365Manifest({ updatedAt: AT }),
        paths,
      }),
    );

    expect(refused.join(" ")).toContain("nothing was written");
  });

  it("accepts a publish derived from the generation actually on disk", () => {
    const paths = microsoft365AtlasPaths({ home: scratchHome() });
    const manifest = initialMicrosoft365Manifest({ updatedAt: AT });
    unwrap(publishMicrosoft365Atlas({ derivedFrom: null, files: { users: usersFile() }, manifest, paths }));
    const held = unwrap(readMicrosoft365Manifest({ paths }));

    const again = publishMicrosoft365Atlas({ derivedFrom: held, files: { users: usersFile() }, manifest, paths });

    expect(again.isOk()).toBe(true);
  });
});

describe("readMicrosoft365Snapshot", () => {
  it("refuses rather than answering zero operations when nothing has been published", () => {
    const read = readMicrosoft365Snapshot({ home: scratchHome() });
    expect(unwrapErr(read).code).toBe("ATLAS_GENERATION_UNPUBLISHED");
  });

  it("projects the compiled channel as the one observation, and names no channel that has not looked", () => {
    const home = scratchHome();
    const paths = microsoft365AtlasPaths({ home });
    unwrap(
      publishMicrosoft365Atlas({
        derivedFrom: null,
        files: { users: usersFile() },
        manifest: initialMicrosoft365Manifest({ updatedAt: AT }),
        paths,
      }),
    );
    const snapshot = unwrap(readMicrosoft365Snapshot({ home }));
    const users = snapshot.kinds.find((kind) => kind.kind === "users")!;
    expect(users.entities[0]?.observations.map((observation) => observation.surface)).toEqual(["compiled"]);
    expect(users.gaps[0]?.condition).toBe("graph-credential-absent");
  });

  it("reads a kind's recorded permission block, and none for a kind whose status declares none", () => {
    const home = scratchHome();
    const manifest = initialMicrosoft365Manifest({ updatedAt: AT });
    const block = { at: AT, detail: "403 Authorization_RequestDenied", unblockedBy: "User.Read.All" };
    unwrap(
      publishMicrosoft365Atlas({
        derivedFrom: null,
        files: { users: usersFile() },
        manifest: {
          ...manifest,
          kinds: { ...manifest.kinds, users: { ...manifest.kinds.users, permissionBlocked: block } },
        },
        paths: microsoft365AtlasPaths({ home }),
      }),
    );
    const snapshot = unwrap(readMicrosoft365Snapshot({ home }));
    expect(snapshot.kinds.find((kind) => kind.kind === "users")!.permissionBlocked).toEqual(block);
    expect(snapshot.kinds.find((kind) => kind.kind === "groups")!.permissionBlocked).toBe(null);
  });

  it("derives the compiled surface's status from the store rather than from a literal", () => {
    const home = scratchHome();
    unwrap(
      publishMicrosoft365Atlas({
        derivedFrom: null,
        files: { users: usersFile() },
        manifest: initialMicrosoft365Manifest({ updatedAt: AT }),
        paths: microsoft365AtlasPaths({ home }),
      }),
    );
    const snapshot = unwrap(readMicrosoft365Snapshot({ home }));
    const compiled = snapshot.descriptor.surfaces.find((surface) => surface.name === "graph-specification")!;
    // The manifest this test published records no success for any kind, so the surface a static descriptor
    // would call `filled` is reported unfilled, and the reason names how far off it is.
    expect(compiled.status).toBe("declared-unfilled");
    expect(compiled.unfilledBecause).toContain("0 of 70 applicable kinds");
  });

  it("hands back the descriptor, whose live Graph surface is declared and unfilled", () => {
    const home = scratchHome();
    unwrap(
      publishMicrosoft365Atlas({
        derivedFrom: null,
        files: { users: usersFile() },
        manifest: initialMicrosoft365Manifest({ updatedAt: AT }),
        paths: microsoft365AtlasPaths({ home }),
      }),
    );
    const snapshot = unwrap(readMicrosoft365Snapshot({ home }));
    const api = snapshot.descriptor.surfaces.find((surface) => surface.name === "graph-api")!;
    expect(api.status).toBe("declared-unfilled");
    expect(snapshot.descriptor.platform).toBe("microsoft365");
  });
});

describe("resetMicrosoft365Atlas", () => {
  it("archives the generation rather than deleting it, and installs an empty one", () => {
    const home = scratchHome();
    const paths = microsoft365AtlasPaths({ home });
    unwrap(
      publishMicrosoft365Atlas({
        derivedFrom: null,
        files: { users: usersFile() },
        manifest: initialMicrosoft365Manifest({ updatedAt: AT }),
        paths,
      }),
    );
    const outcome = unwrap(resetMicrosoft365Atlas({ at: LATER, paths }));
    expect(outcome.archivedTo).toContain(join("atlas", "_superseded", "microsoft365"));
    expect(unwrap(readMicrosoft365Atlas({ paths })).files.users?.entities).toEqual([]);
  });
});
