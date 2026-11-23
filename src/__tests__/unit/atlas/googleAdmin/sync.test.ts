/**
 * The compiled generation, built in memory and published to a throwaway home.
 *
 * `buildGoogleAdminGeneration` is pure, so most of this needs no filesystem at all. The one test that
 * writes does so to a `mkdtempSync` directory it removes, and passes `home` explicitly — the ambient-home
 * guard in `.claude/rules/testing.md` is the reason both halves of that sentence matter.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GoogleAdminFillObservation } from "../../../../atlas/googleAdmin/adminApi/observation.js";
import { isReadonlyScopedWrite } from "../../../../atlas/googleAdmin/compiledGaps.js";
import type { GoogleAdminWalkObservation } from "../../../../atlas/googleAdmin/consoleRoute.js";
import { GOOGLE_ADMIN_SURFACES } from "../../../../atlas/googleAdmin/generated/surfaces.js";
import { GOOGLE_ADMIN_ATLAS_KINDS } from "../../../../atlas/googleAdmin/model.js";
import { readGoogleAdminSnapshot } from "../../../../atlas/googleAdmin/readAdapter.js";
import { googleAdminAtlasPaths, readGoogleAdminKindFile } from "../../../../atlas/googleAdmin/store.js";
import { buildGoogleAdminGeneration, syncGoogleAdminAtlas } from "../../../../atlas/googleAdmin/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-google-admin-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("buildGoogleAdminGeneration", () => {
  it("publishes the 336 methods and 78 record shapes across every kind", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT }));
    const entities = GOOGLE_ADMIN_ATLAS_KINDS.reduce(
      (total, kind) => total + generation.files[kind].entities.length,
      0,
    );
    expect(entities).toBe(414);
  });

  it("files each method under the kind it reaches, so a user read comes back with the user shape", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT }));
    const users = generation.files["directory-users"];
    expect(users.entities.filter((entity) => entity.family === "operation").length).toBe(11);
    expect(users.entities.filter((entity) => entity.family === "record-shape").length).toBe(1);
    expect(users.entities.some((entity) => entity.family === "record")).toBe(false);
  });

  it("leaves the console's landing kind empty and gives it the console gaps", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT }));
    expect(generation.files.page.entities).toStrictEqual([]);
    expect(generation.files.page.gaps.map((gap) => gap.condition).toSorted()).toStrictEqual([
      "adjacent-api-unmapped",
      "no-admin-scope",
      "no-console-session",
    ]);
  });

  it("says the console block is a step-up challenge over a live session, not a missing one", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT }));
    const gap = generation.files.page.gaps.find((candidate) => candidate.condition === "no-console-session")!;
    expect(gap.reason).toContain("step-up reauthentication");
    expect(gap.reason).toContain("Being signed in is therefore not enough");
  });

  it("stores no count from one machine in the gap, so another install does not read a false one", () => {
    // A per-generation record a reader takes as current must not carry a number
    // measured once on one Chrome profile. The dated measurement lives in the descriptor instead.
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT }));
    const gap = generation.files.page.gaps.find((candidate) => candidate.condition === "no-console-session")!;
    expect(gap.reason).not.toContain("24");
    expect(gap.reason).toContain("slopweaver browser cookies --origin https://admin.google.com");
  });

  it("raises the undeclared-scope gap on exactly the five kinds Google publishes scopeless methods for", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT }));
    const raised = GOOGLE_ADMIN_ATLAS_KINDS.filter((kind) =>
      generation.files[kind].gaps.some((gap) => gap.condition === "undeclared-scope"),
    );
    expect([...raised].toSorted()).toStrictEqual([
      "chrome-management-certificate-provisioning-processes",
      "chrome-management-certificate-provisioning-processes-operations",
      "chrome-management-connector-configs",
      "chrome-management-operations",
      "cloud-identity-userinvitations",
    ]);
  });

  it("raises the readonly-scope-grants-a-write gap on both kinds that carry one", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT }));
    const raised = GOOGLE_ADMIN_ATLAS_KINDS.filter((kind) =>
      generation.files[kind].gaps.some((gap) => gap.condition === "readonly-scope-grants-a-write"),
    );
    expect([...raised].toSorted()).toStrictEqual(["chrome-management-notification-configs", "reports-channels"]);
    const gap = generation.files["chrome-management-notification-configs"].gaps.find(
      (candidate) => candidate.condition === "readonly-scope-grants-a-write",
    )!;
    expect(gap.fields).toStrictEqual([
      "chromemanagement.customers.telemetry.notificationConfigs.create",
      "chromemanagement.customers.telemetry.notificationConfigs.delete",
    ]);
    expect(gap.reason).toContain("chrome.management.telemetry.readonly");
  });

  it("finds the same method a readonly-scoped write in one document and not in the other", () => {
    // The asymmetry `gaps.ts` records: two copies of `admin.channels.stop`, two scope sets, one verdict each.
    const copies = GOOGLE_ADMIN_SURFACES.filter((row) => row.id === "admin.channels.stop");
    expect(copies.map((row) => isReadonlyScopedWrite({ row }))).toStrictEqual([false, true]);
  });

  it("grades the compiled channel synced and both live channels not-configured, the console remedy only on page", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT }));
    const cells = generation.files["directory-users"].coverage;
    expect(cells.map((cell) => `${cell.channel}:${cell.state}`)).toStrictEqual([
      "discovery:synced",
      "admin-api:not-configured",
      "admin-console:not-configured",
    ]);
    expect(cells[1]!.unblockedBy).toContain("slopweaver atlas google-admin connect");
    expect(cells[2]!.unblockedBy).toBe(null);
    const pageConsole = generation.files.page.coverage.find((cell) => cell.channel === "admin-console")!;
    expect(pageConsole.unblockedBy).toContain("slopweaver atlas google-admin walk");
  });

  it("builds byte-identical documents for the same instant", () => {
    const first = unwrap(buildGoogleAdminGeneration({ at: AT }));
    const second = unwrap(buildGoogleAdminGeneration({ at: AT }));
    expect(JSON.stringify(second.files)).toBe(JSON.stringify(first.files));
  });
});

/** A walk observation shaped like the one the first real walk produced. */
const OBSERVATION: GoogleAdminWalkObservation = {
  observedRoutes: ["/ac/home", "/ac/managedsettings/{id}", "/ac/users", "/ac/users/{id}"],
  pages: [
    { reached: true, route: "/ac/home", settledRoute: "/ac/home", title: "Admin console" },
    { reached: true, route: "/ac/security", settledRoute: "/ac/managedsettings/{id}", title: "Application settings" },
  ],
  walkedAtIso: "2026-09-06T01:55:00.000Z",
};

describe("buildGoogleAdminGeneration with a walk", () => {
  it("holds one page per route the console LINKED, not only the ones it opened", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT, observation: OBSERVATION }));
    const pages = generation.files.page.entities;
    expect(pages.map((entity) => entity.providerId)).toStrictEqual([
      "/ac/home",
      "/ac/managedsettings/{id}",
      "/ac/security",
      "/ac/users",
      "/ac/users/{id}",
    ]);
    expect(pages.filter((entity) => entity.channels["admin-console"] !== null).length).toBe(2);
  });

  it("stamps a page with the WALK's instant rather than the publish's, so a stale walk cannot look fresh", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT, observation: OBSERVATION }));
    const home = generation.files.page.entities.find((entity) => entity.providerId === "/ac/home")!;
    expect(home.channels["admin-console"]!.lastSeenAt).toBe("2026-09-06T01:55:00.000Z");
  });

  it("records where a route SETTLED, so a redirect is visible rather than silently renamed", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT, observation: OBSERVATION }));
    const security = generation.files.page.entities.find((entity) => entity.providerId === "/ac/security")!;
    const detail = security.channels["admin-console"]!.detail;
    expect(detail).toStrictEqual({
      route: "/ac/security",
      settledUrl: "https://admin.google.com/ac/managedsettings/{id}",
      title: "Application settings",
    });
  });

  it("grades a walked console deferred and never synced, and swaps the gap rather than closing it", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT, observation: OBSERVATION }));
    const cell = generation.files.page.coverage.find((candidate) => candidate.channel === "admin-console")!;
    expect(cell.state).toBe("deferred");
    expect(generation.files.page.gaps.map((gap) => gap.condition).toSorted()).toStrictEqual([
      "adjacent-api-unmapped",
      "console-inventory-is-observed",
      "no-admin-scope",
    ]);
  });
});

describe("syncGoogleAdminAtlas", () => {
  it("publishes a generation the read adapter can read back", () => {
    const home = scratchHome();
    const report = unwrap(syncGoogleAdminAtlas({ at: AT, home }));
    expect(report.entitiesByKind.length).toBe(83);
    expect(report.gaps).toBe(92);

    const snapshot = unwrap(readGoogleAdminSnapshot({ home }));
    expect(snapshot.generation.platform).toBe("google-admin");
    expect(snapshot.generation.updatedAt).toBe(AT);
    expect(snapshot.generation.missing).toStrictEqual([]);
    expect(snapshot.generation.mismatched).toStrictEqual([]);
    const users = snapshot.kinds.find((kind) => kind.kind === "directory-users")!;
    expect(users.entities.length).toBe(12);
    expect(users.publishedCount).toBe(12);
  });

  it("writes the manifest last, after every kind file it names", () => {
    const home = scratchHome();
    const report = unwrap(syncGoogleAdminAtlas({ at: AT, home }));
    expect(report.written.at(-1)).toBe(join(home, "atlas", "google-admin", "manifest.json"));
    expect(report.written.length).toBe(84);
  });

  it("keeps a fill's last success when a later fill of the same kind is refused", () => {
    const home = scratchHome();
    const firstFill: GoogleAdminFillObservation = {
      excluded: [],
      failed: [],
      filledAtIso: "2026-09-06T04:00:00.000Z",
      grantedScopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
      operations: [
        {
          aggregate: false,
          document: "admin.directory_v1",
          id: "directory.users.list",
          kind: "directory-users",
          records: [{ fields: ["id"], providerId: "1" }],
          truncated: false,
        },
      ],
    };
    unwrap(syncGoogleAdminAtlas({ at: AT, fill: firstFill, home }));
    const refusedFill: GoogleAdminFillObservation = {
      excluded: [],
      failed: [{ id: "directory.users.list", kind: "directory-users", message: "forbidden", status: 403 }],
      filledAtIso: "2026-09-07T04:00:00.000Z",
      grantedScopes: [],
      operations: [],
    };
    unwrap(syncGoogleAdminAtlas({ at: "2026-09-07T04:00:00.000Z", fill: refusedFill, home }));

    const paths = googleAdminAtlasPaths({ home });
    const users = unwrap(readGoogleAdminKindFile({ kind: "directory-users", paths }))!;
    const cell = users.coverage.find((candidate) => candidate.channel === "admin-api")!;
    expect(cell.state).toBe("unreadable");
    expect(cell.lastSuccessAt).toBe("2026-09-06T04:00:00.000Z");
    expect(cell.latestAttemptFailed).toBe(true);
  });

  it("stores no value from this Workspace — every published detail is a name Google declared", () => {
    const home = scratchHome();
    unwrap(syncGoogleAdminAtlas({ at: AT, home }));
    const raw = readFileSync(join(home, "atlas", "google-admin", "directory-users.jsonl"), "utf8");
    expect(raw).toContain('"schemaName":"User"');
    expect(raw).toContain("admin.googleapis.com");
    expect(raw).not.toContain("Bearer");
  });
});
