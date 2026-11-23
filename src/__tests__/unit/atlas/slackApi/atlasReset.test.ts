import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { slackAtlasResetFor } from "../../../../atlas/slackApi/atlasReset.js";
import {
  publishSlackAtlas,
  readSlackAtlasKindFile,
  readSlackAtlasManifest,
  type SlackAtlasPaths,
  slackAtlasPaths,
} from "../../../../atlas/slackApi/atlasStore.js";
import { assembleSlackGeneration, type SlackAtlasGeneration } from "../../../../atlas/slackApi/atlasSync.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

import { sdkMethod, TEST_ROOTS, walkedPage } from "./slackAtlasFixtures.js";

const PUBLISHED_AT = "2026-08-31T09:00:00.000Z";
const RESET_AT = "2026-10-18T06:30:00.000Z";
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A state home holding one published generation read from `@slack/web-api` 7.9.3. */
function homeWithSevenGeneration(): SlackAtlasPaths {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-slack-reset-"));
  homes.push(home);
  const paths = slackAtlasPaths({ home });
  const seven = generation({ at: PUBLISHED_AT, sdkVersion: "7.9.3" });
  unwrap(publishSlackAtlas({ derivedFrom: null, files: seven.files, manifest: seven.manifest, paths }));
  return paths;
}

function generation({ at, sdkVersion }: { at: string; sdkVersion: string }): SlackAtlasGeneration {
  return unwrap(
    assembleSlackGeneration({
      at,
      methods: [sdkMethod()],
      roots: TEST_ROOTS,
      screenshots: new Map(),
      sdkVersion,
      session: { pages: [walkedPage()], unreachable: [], workspaceId: "T0SYN1ABCDEFGH" },
      stored: { method: null, page: null },
    }),
  );
}

/** Publish an 8.0.0 generation onto whatever is live, exactly as the next `slack-drive sync` would. */
function publishEight({ paths }: { paths: SlackAtlasPaths }): ReturnType<typeof publishSlackAtlas> {
  const eight = generation({ at: RESET_AT, sdkVersion: "8.0.0" });
  const derivedFrom = unwrap(readSlackAtlasManifest({ paths }));
  return publishSlackAtlas({ derivedFrom, files: eight.files, manifest: eight.manifest, paths });
}

describe("slackAtlasResetFor", () => {
  it("archives the published generation whole and installs an empty one stamped with the installed SDK", () => {
    const paths = homeWithSevenGeneration();
    const reset = slackAtlasResetFor({ readSdkVersion: () => ok("8.0.0") });

    const outcome = unwrap(reset({ at: RESET_AT, home: paths.home }));

    expect(outcome.archiveId).toBe("2026-10-18T06-30-00.000Z");
    expect(outcome.archivedTo).toBe(join(paths.superseded, "2026-10-18T06-30-00.000Z"));
    expect(readFileSync(join(outcome.archivedTo, "manifest.json"), "utf8")).toContain('"sdkVersion": "7.9.3"');
    const installed = unwrap(readSlackAtlasManifest({ paths }))!;
    expect(installed.sdkVersion).toBe("8.0.0");
    expect(installed.updatedAt).toBe(RESET_AT);
    expect(unwrap(readSlackAtlasKindFile({ kind: "method", paths }))!.entities).toEqual([]);
    expect(unwrap(readSlackAtlasKindFile({ kind: "page", paths }))!.entities).toEqual([]);
  });

  it("clears the SDK-major refusal it is printed for: the next publish across the major lands", () => {
    const paths = homeWithSevenGeneration();
    unwrap(slackAtlasResetFor({ readSdkVersion: () => ok("8.0.0") })({ at: RESET_AT, home: paths.home }));

    const written = unwrap(publishEight({ paths }));

    expect(written).toEqual([paths.kinds.method, paths.kinds.page, paths.manifest]);
    expect(unwrap(readSlackAtlasManifest({ paths }))!.sdkVersion).toBe("8.0.0");
  });

  it("would not clear it if the empty generation carried the old major forward", () => {
    const paths = homeWithSevenGeneration();
    unwrap(slackAtlasResetFor({ readSdkVersion: () => ok("7.9.3") })({ at: RESET_AT, home: paths.home }));

    const refused = unwrapErr(publishEight({ paths }));

    expect(refused[0]).toBe("this generation was published from @slack/web-api 7.9.3 and this build reads 8.0.0");
  });

  it("archives nothing when the installed SDK version cannot be read", () => {
    const paths = homeWithSevenGeneration();
    const reset = slackAtlasResetFor({ readSdkVersion: () => err(["@slack/web-api is not installed"]) });

    const refused = unwrapErr(reset({ at: RESET_AT, home: paths.home }));

    expect(refused).toEqual([
      "@slack/web-api is not installed",
      "nothing was archived — the Slack atlas generation is unchanged",
    ]);
    expect(existsSync(paths.superseded)).toBe(false);
    expect(unwrap(readSlackAtlasManifest({ paths }))!.sdkVersion).toBe("7.9.3");
  });
});
