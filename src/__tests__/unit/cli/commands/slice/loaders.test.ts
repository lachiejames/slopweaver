/**
 * The `slice` command modules are importable and expose the handlers the manifest names.
 *
 * This is the floor the `manifest-loader-tests` gate enforces: a command the CLI can dispatch that no unit
 * test imports is invisible to the whole suite, so "shipped but wired to nothing" stays true and nothing
 * says so. Importing is not coverage — the behaviour is tested in `corpus/slice.test.ts` — but a module that
 * cannot even be loaded is caught here rather than by a user.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseSentinel, parseSentinels, sliceCaptureCommand } from "../../../../../cli/commands/slice/capture.js";
import { SLICE_VERBS, verbTail } from "../../../../../cli/commands/slice/core.js";
import { sliceVerifyCommand } from "../../../../../cli/commands/slice/verify.js";
import { readSliceManifest } from "../../../../../corpus/sliceStore.js";
import { unwrap } from "../../../../../lib/result.js";

describe("slice command modules", () => {
  // Exercised rather than merely imported: `--help` is the one path that touches no disk and no corpus, so
  // it proves the module loads AND dispatches without needing a fixture.
  it("dispatch their help without touching a corpus", async () => {
    expect(await sliceCaptureCommand(["node", "cli", "slice", "capture", "--help"])).toBe(0);
    expect(await sliceVerifyCommand(["node", "cli", "slice", "verify", "--help"])).toBe(0);
  });

  it("refuse to run without the flags they require, rather than defaulting", async () => {
    expect(await sliceVerifyCommand(["node", "cli", "slice", "verify"])).toBe(2);
    expect(await sliceCaptureCommand(["node", "cli", "slice", "capture", "--name", "x"])).toBe(2);
  });
});

describe("slice capture and verify over a corrupt profile.json", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A throwaway home and an empty root to capture from. */
  function fixture(): { home: string; root: string } {
    const home = mkdtempSync(join(tmpdir(), "slice-profile-home-"));
    const root = mkdtempSync(join(tmpdir(), "slice-profile-root-"));
    dirs.push(home, root);
    return { home, root };
  }

  it("capture exits 1 and pins nothing, where the same capture with no profile pins the slice", async () => {
    const { home, root } = fixture();
    const argv = ["node", "cli", "slice", "capture", "--name", "pinned", "--root", root, "--home", home];
    writeFileSync(join(home, "profile.json"), "{");
    expect(await sliceCaptureCommand(argv)).toBe(1);
    expect(readSliceManifest({ home, name: "pinned" }).isErr()).toBe(true);

    rmSync(join(home, "profile.json"));
    expect(await sliceCaptureCommand(argv)).toBe(0);
    expect(unwrap(readSliceManifest({ home, name: "pinned" })).name).toBe("pinned");
  });

  it("verify exits 1 over a pinned slice once the profile turns corrupt", async () => {
    const { home, root } = fixture();
    const capture = ["node", "cli", "slice", "capture", "--name", "pinned", "--root", root, "--home", home];
    expect(await sliceCaptureCommand(capture)).toBe(0);
    writeFileSync(join(home, "profile.json"), "{");
    expect(await sliceVerifyCommand(["node", "cli", "slice", "verify", "--name", "pinned", "--home", home])).toBe(1);
  });
});

describe("verbTail", () => {
  // The defect this exists to avoid: a hard-coded `argv.slice(3)` eats the verb token, which is why
  // `slopweaver audit run` exits 2 with "unexpected argument: run" on main today.
  it("drops the verb token for the named form", () => {
    expect(verbTail({ argv: ["node", "cli", "slice", "verify", "--name", "x"], verbs: SLICE_VERBS })).toEqual([
      "--name",
      "x",
    ]);
  });

  it("keeps everything for the bare form", () => {
    expect(verbTail({ argv: ["node", "cli", "slice", "--name", "x"], verbs: SLICE_VERBS })).toEqual(["--name", "x"]);
  });

  // A flag VALUE that happens to equal a verb name must not be eaten — only argv[3] is ever a verb.
  it("does not eat a later argument that merely looks like a verb", () => {
    expect(verbTail({ argv: ["node", "cli", "slice", "--name", "verify"], verbs: SLICE_VERBS })).toEqual([
      "--name",
      "verify",
    ]);
  });
});

describe("parseSentinel", () => {
  it("splits text from the query it should be found by", () => {
    expect(parseSentinel({ raw: "SENTINEL-ONE::what did we decide" })).toEqual({
      query: "what did we decide",
      text: "SENTINEL-ONE",
    });
  });

  it("refuses a value with no separator", () => {
    expect(parseSentinel({ raw: "SENTINEL-ONE" })).toBe(undefined);
  });

  it("refuses an empty half on either side", () => {
    expect(parseSentinel({ raw: "::a query" })).toBe(undefined);
    expect(parseSentinel({ raw: "SENTINEL-ONE::" })).toBe(undefined);
  });

  // All-or-nothing: a slice that pinned three of four sentinels would later report a clean handoff over an
  // incomplete claim, which is this capability's own failure mode.
  it("refuses the whole set when any one value is malformed", () => {
    expect(parseSentinels({ raws: ["A::q", "malformed"] })).toBe(undefined);
  });

  it("parses a whole valid set", () => {
    expect(parseSentinels({ raws: ["A::q1", "B::q2"] })?.length).toBe(2);
  });
});
