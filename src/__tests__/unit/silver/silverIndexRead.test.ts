import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silverIndexDir } from "../../../corpus/corpusPaths.js";
import { writeJsonFile } from "../../../lib/jsonFile.js";
import { readSilverIndex } from "../../../silver/silverIndexRead.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-silver-index-"));
  mkdirSync(silverIndexDir({ home }), { recursive: true });
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readSilverIndex", () => {
  it("keeps every real CorpusSource in a directory entry's sources", () => {
    writeJsonFile({
      path: join(silverIndexDir({ home }), "directory.json"),
      value: { people: [{ id: "p1", kind: "person", sources: ["github", "slack"] }] },
    });
    const index = readSilverIndex({ home });
    expect(index.people[0]!.sources).toEqual(["github", "slack"]);
  });

  it("drops a source that is not a real CorpusSource rather than passing it through", () => {
    writeJsonFile({
      path: join(silverIndexDir({ home }), "directory.json"),
      value: { people: [{ id: "p1", kind: "person", sources: ["github", "not-a-real-source"] }] },
    });
    const index = readSilverIndex({ home });
    expect(index.people[0]!.sources).toEqual(["github"]);
  });
});
