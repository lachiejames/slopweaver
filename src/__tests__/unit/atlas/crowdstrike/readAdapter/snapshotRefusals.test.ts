/*
 * `readCrowdstrikeSnapshot` refuses an unpublished home and a corrupt manifest by name, rather than answering an
 * empty atlas.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";
import { readCrowdstrikeSnapshot } from "../../../../../atlas/crowdstrike/readAdapter.js";
import { crowdstrikeAtlasPaths } from "../../../../../atlas/crowdstrike/store.js";
import { AtlasReadErrors } from "../../../../../atlas/kit/read.js";
import { scratchHome, useScratchHomes } from "./harness.js";

useScratchHomes();

describe("readCrowdstrikeSnapshot", () => {
  it("refuses an empty home as unpublished and names the sync verb, rather than answering zero hosts", () => {
    const error = unwrapErr(readCrowdstrikeSnapshot({ home: scratchHome() }));
    expect(error).toEqual(
      AtlasReadErrors.generationUnpublished({
        platform: "crowdstrike",
        remedy:
          "run: slopweaver crowdstrike sync — it reads the Falcon tenant through a read-only API client whose credential `slopweaver secrets status` names",
      }),
    );
  });

  it("refuses a corrupt manifest as unreadable, naming the file, rather than reading it as an empty atlas", () => {
    const home = scratchHome();
    const paths = crowdstrikeAtlasPaths({ home });
    mkdirSync(dirname(paths.manifest), { recursive: true });
    writeFileSync(paths.manifest, "{ this is not json");
    const error = unwrapErr(readCrowdstrikeSnapshot({ home }));
    expect(error).toEqual(
      AtlasReadErrors.storeUnreadable({
        platform: "crowdstrike",
        reasons: [
          `${paths.manifest} is not valid JSON`,
          "refusing rather than treating a corrupt atlas as an empty one",
        ],
      }),
    );
  });
});
