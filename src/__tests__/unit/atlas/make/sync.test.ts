/**
 * Unit: one fill published into a throwaway home and read back through the read adapter — every kind graded,
 * the strict-boundary gap open, first sightings kept across runs, the scenario table drawn — with every
 * secret the fixture fed in absent from disk.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { atlasPageModel } from "../../../../atlas/kit/pageModel.js";
import { MAKE_TOKEN_SECRET } from "../../../../atlas/make/credential.js";
import { type MakeFillObservation, runMakeFill } from "../../../../atlas/make/fill/run.js";
import { MAKE_STRICT_BOUNDARY_GAP } from "../../../../atlas/make/gaps.js";
import { readMakeSnapshot } from "../../../../atlas/make/readAdapter.js";
import { makeAtlasPaths, publishMakeAtlas, readMakeAtlas } from "../../../../atlas/make/store.js";
import { syncMakeAtlas } from "../../../../atlas/make/sync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { cloneHome } from "../homeTemplate.js";
import { BLUEPRINT, CONNECTIONS, fixtureRead, HOOKS, SECRET_MARKERS } from "./makeFixtures.js";

const AT = "2026-10-15T00:00:00.000Z";
const LATER = "2026-10-16T00:00:00.000Z";

/** The fixture organisation, filled at this instant. */
async function fixtureFill({ at }: { at: string }): Promise<MakeFillObservation> {
  return unwrap(await runMakeFill({ at, read: fixtureRead({ seen: [] }) }));
}

describe("syncMakeAtlas", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const dir of homes.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A fresh state home, removed after the test. */
  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "make-sync-"));
    homes.push(dir);
    return dir;
  }

  /**
   * The fixture filled at AT into a home with no token configured, published ONCE and copied into each case
   * that starts from exactly that, rather than re-published per case (`homeTemplate.ts` says why). Nothing
   * writes into it; a case that configures a token BEFORE its sync still runs its own.
   */
  let filledAtAt: string;
  beforeAll(async () => {
    filledAtAt = mkdtempSync(join(tmpdir(), "make-sync-template-"));
    unwrap(syncMakeAtlas({ fill: await fixtureFill({ at: AT }), home: filledAtAt }));
  });
  afterAll(() => {
    rmSync(filledAtAt, { force: true, recursive: true });
  });

  /** A copy of the filled-at-AT home, removed after the test. */
  function filledHome(): string {
    const dir = cloneHome({ prefix: "make-sync-", template: filledAtAt });
    homes.push(dir);
    return dir;
  }

  it("answers an unpublished store with the token step, not an empty atlas", () => {
    const failure = unwrapErr(readMakeSnapshot({ home: home() }));
    expect(failure.code).toBe("ATLAS_GENERATION_UNPUBLISHED");
    expect(failure.message).toContain("slopweaver secrets set make-api-token");
  });

  it("publishes every kind and reads it back through the adapter", async () => {
    const dir = home();
    const report = unwrap(syncMakeAtlas({ fill: await fixtureFill({ at: AT }), home: dir }));
    expect(report.entitiesByKind).toStrictEqual([
      { entities: 1, kind: "connection" },
      { entities: 2, kind: "execution" },
      { entities: 2, kind: "folder" },
      { entities: 1, kind: "hook" },
      { entities: 1, kind: "organization" },
      { entities: 1, kind: "scenario" },
      { entities: 1, kind: "team" },
    ]);
    const snapshot = unwrap(readMakeSnapshot({ home: dir }));
    expect(snapshot.generation.unpublished).toStrictEqual([]);
    expect(snapshot.kinds.map((kind) => `${kind.kind}:${String(kind.lastSuccessAt)}`)).toStrictEqual([
      `connection:${AT}`,
      `execution:${AT}`,
      `folder:${AT}`,
      `hook:${AT}`,
      `organization:${AT}`,
      `scenario:${AT}`,
      `team:${AT}`,
    ]);
    const scenario = snapshot.kinds.find((kind) => kind.kind === "scenario")!.entities[0]!;
    expect(scenario.observations.map((seen) => seen.surface)).toStrictEqual(["make-api-v2"]);
  });

  it("grades each kind by the reads that fill it, and opens the strict-boundary gap on the organisation", () => {
    const dir = filledHome();
    const kinds = unwrap(readMakeSnapshot({ home: dir })).kinds;
    const scenario = kinds.find((kind) => kind.kind === "scenario")!;
    expect(scenario.coverage.map((cell) => `${cell.scope}:${cell.state}`)).toStrictEqual([
      "blueprints.get:synced",
      "scenarios.list:synced",
    ]);
    const organization = kinds.find((kind) => kind.kind === "organization")!;
    expect(organization.gaps.map((gap) => `${gap.condition}:${gap.status}`)).toStrictEqual([
      `${MAKE_STRICT_BOUNDARY_GAP}:open`,
    ]);
  });

  it("keeps the first time an entity was seen across runs", async () => {
    const dir = filledHome();
    unwrap(syncMakeAtlas({ fill: await fixtureFill({ at: LATER }), home: dir }));
    const hook = unwrap(readMakeSnapshot({ home: dir })).kinds.find((kind) => kind.kind === "hook")!;
    expect(hook.lastSuccessAt).toBe(LATER);
    const stored = readMakeAtlas({ paths: makeAtlasPaths({ home: dir }) });
    const api = unwrap(stored).files.hook!.entities[0]!.channels.api!;
    expect([api.firstSeenAt, api.lastSeenAt]).toStrictEqual([AT, LATER]);
  });

  it("writes no secret the fixture carried", async () => {
    const fed = JSON.stringify([BLUEPRINT, CONNECTIONS, HOOKS]);
    expect(SECRET_MARKERS.filter((marker) => fed.includes(marker))).toStrictEqual([...SECRET_MARKERS]);
    const dir = home();
    const report = unwrap(syncMakeAtlas({ fill: await fixtureFill({ at: AT }), home: dir }));
    expect(report.written.length).toBeGreaterThan(0);
    const onDisk = report.written.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(onDisk).toContain("knowbe4:deleteUser");
    expect(SECRET_MARKERS.filter((marker) => onDisk.includes(marker))).toStrictEqual([]);
  });

  it("refuses to publish a hook whose detail carries a field its allowlist does not keep, writing nothing", () => {
    const dir = filledHome();
    const paths = makeAtlasPaths({ home: dir });
    const { files, manifest } = unwrap(readMakeAtlas({ paths }));
    const hook = files.hook!;
    const entity = hook.entities[0]!;
    const api = entity.channels.api!;
    const leakyDetail = { ...(api.detail as Record<string, unknown>), url: "https://hook.make.com/SECRET-URL" };
    const leaky = {
      ...hook,
      entities: [{ ...entity, channels: { ...entity.channels, api: { ...api, detail: leakyDetail } } }],
    };
    const refused = unwrapErr(
      publishMakeAtlas({ derivedFrom: manifest, files: { hook: leaky }, manifest: manifest!, paths }),
    );
    expect(refused.join("\n")).toContain(
      "make hook entity 0 (api): its detail carries a field the hook allowlist does not keep",
    );
    expect(refused.join("\n")).not.toContain(entity.providerId);
    expect(readFileSync(paths.kinds.hook, "utf8")).not.toContain("SECRET-URL");
  });

  it("refuses to serve a stored hook file edited to carry a field its allowlist does not keep", () => {
    const dir = filledHome();
    const path = makeAtlasPaths({ home: dir }).kinds.hook;
    const edited = readFileSync(path, "utf8").replace('"detail":{', '"detail":{"udid":"SECRET-UDID",');
    expect(edited).toContain("SECRET-UDID");
    writeFileSync(path, edited);
    const failure = unwrapErr(readMakeSnapshot({ home: dir }));
    expect(failure.code).toBe("ATLAS_STORE_UNREADABLE");
    expect(failure.message).toContain("its detail carries a field the hook allowlist does not keep");
  });

  it("strips the token configured now from stored text a fill under another token kept, on every read", () => {
    const dir = filledHome();
    const stored = readFileSync(makeAtlasPaths({ home: dir }).kinds.scenario, "utf8");
    expect(stored).toContain("Removes a leaver from KnowBe4");
    mkdirSync(join(dir, "secrets"), { mode: 0o700 });
    writeFileSync(join(dir, "secrets", MAKE_TOKEN_SECRET), "KnowBe4\n", { mode: 0o600 });
    const snapshot = unwrap(readMakeSnapshot({ home: dir }));
    const scenario = snapshot.kinds.find((kind) => kind.kind === "scenario")!.entities[0]!;
    expect((scenario.detail as { description: string }).description).toBe(
      "Removes a leaver from [make-api-token] and marks them offboarded in Vanta",
    );
    expect(snapshot.pageDetailTables!.at(0)!.rows[0]![1]).toContain("Removes a leaver from [make-api-token]");
  });

  it("strips the configured token from every detail at the write, whatever handed publish its files", async () => {
    const dir = home();
    mkdirSync(join(dir, "secrets"), { mode: 0o700 });
    writeFileSync(join(dir, "secrets", MAKE_TOKEN_SECRET), "KnowBe4\n", { mode: 0o600 });
    const fill = await fixtureFill({ at: AT });
    expect(JSON.stringify(fill.items.scenario)).toContain("KnowBe4");
    unwrap(syncMakeAtlas({ fill, home: dir }));
    const stored = readFileSync(makeAtlasPaths({ home: dir }).kinds.scenario, "utf8");
    expect(stored).toContain("Removes a leaver from [make-api-token] and marks them offboarded in Vanta");
    expect(stored).not.toContain("KnowBe4");
  });

  it("strips the configured token from a provider id too, on the write and on the read", () => {
    const dir = filledHome();
    const paths = makeAtlasPaths({ home: dir });
    const { files, manifest } = unwrap(readMakeAtlas({ paths }));
    const hook = files.hook!;
    const odd = { ...hook, entities: [{ ...hook.entities[0]!, providerId: "TOKEN-X" }] };
    unwrap(publishMakeAtlas({ derivedFrom: manifest, files: { hook: odd }, manifest: manifest!, paths }));
    expect(readFileSync(paths.kinds.hook, "utf8")).toContain('"providerId":"TOKEN-X"');
    mkdirSync(join(dir, "secrets"), { mode: 0o700 });
    writeFileSync(join(dir, "secrets", MAKE_TOKEN_SECRET), "TOKEN-X\n", { mode: 0o600 });
    const read = unwrap(readMakeSnapshot({ home: dir })).kinds.find((kind) => kind.kind === "hook")!;
    expect(read.entities.map((entity) => entity.providerId)).toStrictEqual(["[make-api-token]"]);
    const current = unwrap(readMakeAtlas({ paths })).manifest;
    unwrap(publishMakeAtlas({ derivedFrom: current, files: { hook: odd }, manifest: current!, paths }));
    const stored = readFileSync(paths.kinds.hook, "utf8");
    expect(stored).toContain('"providerId":"[make-api-token]"');
    expect(stored).not.toContain("TOKEN-X");
  });

  it("strips the configured token from the manifest at the write, attempt reasons included", () => {
    const dir = filledHome();
    const paths = makeAtlasPaths({ home: dir });
    const { manifest } = unwrap(readMakeAtlas({ paths }));
    const failed = { at: AT, outcome: "failed" as const, reasons: ["answered with tok-123 in its body"] };
    const leaky = {
      ...manifest!,
      kinds: { ...manifest!.kinds, organization: { ...manifest!.kinds.organization, lastAttempt: failed } },
    };
    mkdirSync(join(dir, "secrets"), { mode: 0o700 });
    writeFileSync(join(dir, "secrets", MAKE_TOKEN_SECRET), "tok-123\n", { mode: 0o600 });
    unwrap(publishMakeAtlas({ derivedFrom: manifest, files: {}, manifest: leaky, paths }));
    const stored = readFileSync(paths.manifest, "utf8");
    expect(stored).toContain("answered with [make-api-token] in its body");
    expect(stored).not.toContain("tok-123");
  });

  it("strips the configured token from a store failure that quotes the stored line it choked on", () => {
    const dir = filledHome();
    const path = makeAtlasPaths({ home: dir }).kinds.hook;
    writeFileSync(path, `${readFileSync(path, "utf8")}SECRET-TOKEN\n`);
    expect(unwrapErr(readMakeSnapshot({ home: dir })).message).toContain("SECRET-TOKEN");
    mkdirSync(join(dir, "secrets"), { mode: 0o700 });
    writeFileSync(join(dir, "secrets", MAKE_TOKEN_SECRET), "SECRET-TOKEN\n", { mode: 0o600 });
    const failure = unwrapErr(readMakeSnapshot({ home: dir }));
    expect(failure.message).toContain("[make-api-token]");
    expect(failure.message).not.toContain("SECRET-TOKEN");
  });

  it("carries the scenario table into the page model", () => {
    const dir = filledHome();
    const model = atlasPageModel({ snapshot: unwrap(readMakeSnapshot({ home: dir })) });
    expect(model.detailTables.map((table) => `${table.id}:${String(table.rowCount)}`)).toStrictEqual([
      "make-scenarios:1",
    ]);
    expect(model.detailTables[0]!.rows).toStrictEqual([
      [
        "Offboard leaver (#1000)",
        "Removes a leaver from KnowBe4 and marks them offboarded in Vanta — gateway → builtin → knowbe4 → vanta (4 modules)",
        "immediately, on each trigger",
        "on",
        "A Builder / An Editor (IT Ops)",
        "2026-10-14T00:00:00.000Z · success",
      ],
    ]);
  });
});
