import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { initialSlackAtlasManifest, type SlackAtlasManifest } from "../../../../atlas/slackApi/atlasModel.js";
import {
  guardSdkMajor,
  publishSlackAtlas,
  readSlackAtlas,
  readSlackAtlasKindFile,
  readSlackAtlasManifest,
  slackAtlasJson,
  slackAtlasPaths,
} from "../../../../atlas/slackApi/atlasStore.js";
import { assembleSlackGeneration } from "../../../../atlas/slackApi/atlasSync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { sdkMethod, TEST_ROOTS, walkedPage } from "./slackAtlasFixtures.js";

const AT = "2026-08-31T09:00:00.000Z";
const homes: string[] = [];

function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-slack-atlas-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function manifest(over: Partial<SlackAtlasManifest> = {}): SlackAtlasManifest {
  return { ...initialSlackAtlasManifest({ sdkVersion: "7.9.3", updatedAt: AT }), ...over };
}

describe("slackAtlasPaths", () => {
  it("puts the generation under the home's own atlas sub-tree", () => {
    const paths = slackAtlasPaths({ home: "/var/scratch/state" });
    expect(paths.directory).toBe("/var/scratch/state/atlas/slack");
    expect(paths.manifest).toBe("/var/scratch/state/atlas/slack/manifest.json");
  });

  it("gives each kind a greppable file of its own", () => {
    const paths = slackAtlasPaths({ home: "/var/scratch/state" });
    expect(paths.kinds.method).toBe("/var/scratch/state/atlas/slack/methods.jsonl");
    expect(paths.kinds.page).toBe("/var/scratch/state/atlas/slack/pages.jsonl");
  });
});

describe("guardSdkMajor", () => {
  it("permits a first publish", () => {
    expect(guardSdkMajor({ next: manifest(), prior: null }).isOk()).toBe(true);
  });

  it("permits a patch or minor bump, which neither renames nor removes a method", () => {
    const guarded = guardSdkMajor({ next: manifest({ sdkVersion: "7.10.0" }), prior: manifest() });
    expect(guarded.isOk()).toBe(true);
  });

  it("refuses a MAJOR bump, which would mark the old major's methods stale as if Slack removed them", () => {
    const refused = unwrapErr(guardSdkMajor({ next: manifest({ sdkVersion: "8.0.0" }), prior: manifest() }));
    expect(refused[0]).toContain("7.9.3");
    expect(refused[1]).toContain("reads as Slack having removed them");
  });

  it("names both versions, the stale-methods reason and the supersede remedy, one line each", () => {
    const refused = unwrapErr(guardSdkMajor({ next: manifest({ sdkVersion: "8.0.0" }), prior: manifest() }));
    expect(refused).toEqual([
      "this generation was published from @slack/web-api 7.9.3 and this build reads 8.0.0",
      "a major bump renames and removes methods, so accumulating across one would mark the old major's methods stale — which reads as Slack having removed them",
      "run: slopweaver atlas slack reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write",
    ]);
  });

  it("never refuses on a version it cannot parse — that is a package fact, not a mismatch", () => {
    const guarded = guardSdkMajor({ next: manifest({ sdkVersion: "workspace:*" }), prior: manifest() });
    expect(guarded.isOk()).toBe(true);
  });
});

describe("the published generation", () => {
  it("round-trips through the store", () => {
    const home = scratchHome();
    const paths = slackAtlasPaths({ home });
    const generation = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: { pages: [walkedPage()], unreachable: [], workspaceId: "T0SYN1ABCDEFGH" },
        stored: { method: null, page: null },
      }),
    );
    const written = unwrap(
      publishSlackAtlas({ files: generation.files, manifest: generation.manifest, derivedFrom: null, paths }),
    );
    expect(written).toEqual([paths.kinds.method, paths.kinds.page, paths.manifest]);
    expect(unwrap(readSlackAtlasManifest({ paths }))!.sdkVersion).toBe("7.9.3");
    expect(unwrap(readSlackAtlasKindFile({ kind: "method", paths }))!.entities).toHaveLength(1);
  });

  it("leaves an entity on disk carrying a browser channel with browser-discovered provenance", () => {
    const home = scratchHome();
    const paths = slackAtlasPaths({ home });
    const generation = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: { pages: [walkedPage()], unreachable: [], workspaceId: "T0SYN1ABCDEFGH" },
        stored: { method: null, page: null },
      }),
    );
    unwrap(publishSlackAtlas({ files: generation.files, manifest: generation.manifest, derivedFrom: null, paths }));
    const onDisk = unwrap(readSlackAtlasKindFile({ kind: "page", paths }));
    expect(slackAtlasJson({ value: onDisk })).toContain('"deepLinkStatus": "browser-discovered"');
  });

  it("reads back with the manifest and the files agreeing", () => {
    const home = scratchHome();
    const paths = slackAtlasPaths({ home });
    const generation = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: { pages: [walkedPage()], unreachable: [], workspaceId: "T0SYN1ABCDEFGH" },
        stored: { method: null, page: null },
      }),
    );
    unwrap(publishSlackAtlas({ files: generation.files, manifest: generation.manifest, derivedFrom: null, paths }));
    const snapshot = unwrap(readSlackAtlas({ paths }));
    expect(snapshot.mismatched).toEqual([]);
    expect(snapshot.missing).toEqual([]);
    expect(snapshot.unpublished).toEqual([]);
  });

  it("reads an unpublished home as empty rather than as an error", () => {
    const snapshot = unwrap(readSlackAtlas({ paths: slackAtlasPaths({ home: scratchHome() }) }));
    expect(snapshot.manifest).toBe(null);
    expect(snapshot.files.method).toBe(null);
  });

  it("refuses to publish across an SDK major, writing nothing", () => {
    const home = scratchHome();
    const paths = slackAtlasPaths({ home });
    const from = ({ sdkVersion }: { sdkVersion: string }): ReturnType<typeof assembleSlackGeneration> =>
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion,
        session: { pages: [walkedPage()], unreachable: [], workspaceId: "T0SYN1ABCDEFGH" },
        stored: { method: null, page: null },
      });
    const seven = unwrap(from({ sdkVersion: "7.9.3" }));
    unwrap(publishSlackAtlas({ derivedFrom: null, files: seven.files, manifest: seven.manifest, paths }));
    const held = unwrap(readSlackAtlasManifest({ paths }));
    const eight = unwrap(from({ sdkVersion: "8.0.0" }));

    const refused = unwrapErr(
      publishSlackAtlas({ derivedFrom: held, files: eight.files, manifest: eight.manifest, paths }),
    );

    expect(refused.at(-1)).toBe("nothing was written — this generation is not published");
    expect(unwrap(readSlackAtlasManifest({ paths }))!.sdkVersion).toBe("7.9.3");
  });

  it("prints the major-bump refusal followed by one publish trailer, and nothing else", () => {
    const home = scratchHome();
    const paths = slackAtlasPaths({ home });
    const from = ({ sdkVersion }: { sdkVersion: string }): ReturnType<typeof assembleSlackGeneration> =>
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion,
        session: { pages: [walkedPage()], unreachable: [], workspaceId: "T0SYN1ABCDEFGH" },
        stored: { method: null, page: null },
      });
    const seven = unwrap(from({ sdkVersion: "7.9.3" }));
    unwrap(publishSlackAtlas({ derivedFrom: null, files: seven.files, manifest: seven.manifest, paths }));
    const held = unwrap(readSlackAtlasManifest({ paths }));
    const eight = unwrap(from({ sdkVersion: "8.0.0" }));

    const refused = unwrapErr(
      publishSlackAtlas({ derivedFrom: held, files: eight.files, manifest: eight.manifest, paths }),
    );

    expect(refused).toEqual([
      "this generation was published from @slack/web-api 7.9.3 and this build reads 8.0.0",
      "a major bump renames and removes methods, so accumulating across one would mark the old major's methods stale — which reads as Slack having removed them",
      "run: slopweaver atlas slack reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write",
      "nothing was written — this generation is not published",
    ]);
  });
});
