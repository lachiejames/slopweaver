import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VANTA_KINDS } from "../../../../atlas/vanta/model.js";
import { vantaAtlasPaths } from "../../../../atlas/vanta/store.js";

/**
 * A kind with no file is a RUNTIME fault, not a compile error, which is why this test exists.
 *
 * `AtlasPlatformPaths.kinds` is `Readonly<Record<string, string>>` — a kit type shared by every atlas, so it
 * cannot be narrowed to `VantaKind` without threading a generic through the whole kit. MEASURED
 * while the eight identifier-free families landed: adding a kind to `VANTA_KINDS` and forgetting its entry
 * in `atlasHome.ts` produced eight copies of `The "path" argument must be of type string ... Received
 * undefined` from deep inside the store, on every sync and reset, naming no kind at all. This test names
 * the missing kind instead.
 */
describe("every Vanta kind has a file to be written to", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-kind-files-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("names a path for every kind in VANTA_KINDS", () => {
    const paths = vantaAtlasPaths({ home });
    const missing = VANTA_KINDS.filter((kind) => paths.kinds[kind] === undefined);
    expect(missing).toEqual([]);
  });

  it("gives every kind a DISTINCT file, so one cannot overwrite another", () => {
    const paths = vantaAtlasPaths({ home });
    const files = VANTA_KINDS.map((kind) => paths.kinds[kind]);
    expect(new Set(files).size).toBe(VANTA_KINDS.length);
  });
});
