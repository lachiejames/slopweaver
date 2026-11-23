/*
 * `readGithubSnapshot` refuses an unpublished home and a corrupt manifest by name, rather than answering an empty
 * atlas.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";
import { readGithubSnapshot } from "../../../../../atlas/github/readAdapter.js";
import { githubAtlasPaths } from "../../../../../atlas/github/store.js";
import { AtlasReadErrors } from "../../../../../atlas/kit/read.js";
import { scratchHome, useScratchHomes } from "./harness.js";

useScratchHomes();

describe("readGithubSnapshot", () => {
  it("refuses an empty home as unpublished and names the sync verb, rather than answering zero settings", () => {
    const error = unwrapErr(readGithubSnapshot({ home: scratchHome() }));
    expect(error).toEqual(
      AtlasReadErrors.generationUnpublished({
        platform: "github",
        remedy:
          "run: slopweaver atlas github sync — it reads every organisation and repository setting through a closed read-only inventory",
      }),
    );
  });

  it("refuses a corrupt manifest as unreadable, naming the file, rather than reading it as an empty atlas", () => {
    const home = scratchHome();
    const paths = githubAtlasPaths({ home });
    mkdirSync(dirname(paths.manifest), { recursive: true });
    writeFileSync(paths.manifest, "{ this is not json");
    const error = unwrapErr(readGithubSnapshot({ home }));
    expect(error).toEqual(
      AtlasReadErrors.storeUnreadable({
        platform: "github",
        reasons: [
          `${paths.manifest} is not valid JSON`,
          "refusing rather than treating a corrupt atlas as an empty one",
        ],
      }),
    );
  });
});
