/**
 * A boot whose slot was built from its root's current commit copies nothing, and every other boot copies.
 */

import {
  existsSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import {
  commitAll,
  currentTree,
  FILES_PER_DIR,
  fixture,
  LAST_BOOTED_A_MONTH_AGO,
  MATCH_LINE,
  mirrorRoot,
  runOnce,
  stampOf,
  useFixtureCleanup,
} from "./harness.js";

useFixtureCleanup();

describe("a boot whose mirror already matches its commit copies nothing", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /**
   * MEASURED: seven of these hooks were copying at once and the load went 5 -> 52. A resume,
   * a compaction or a second session on an unchanged worktree re-copied 8.4k files into the OTHER slot, though
   * the slot `current` named was built from that very commit. On the real tree the skip is 0.41s against a
   * 5.71s build: `PLUGIN_ROOT=$PWD PLUGIN_DATA=$(mktemp -d) BIN_DIR=$(mktemp -d) /usr/bin/time -p bash
   * scripts/plugin-mirror-sync.sh`, twice, on a clean checkout.
   */
  it("stamps the slot it builds, then skips on the same commit without touching the other slot", () => {
    const { root, data, bin } = fixture();
    const head = commitAll({ message: "one", root });
    expect(runOnce({ bin, data, root })).not.toContain(MATCH_LINE);
    expect(readFileSync(stampOf({ data, root, slot: ".slot-a" }), "utf8")).toBe(`${head}\n`);

    expect(runOnce({ bin, data, root })).toContain(`${MATCH_LINE} ${head.slice(0, 12)}`);
    expect(readlinkSync(join(mirrorRoot({ data, root }), "current"))).toBe(".slot-a");
    // The copy it did not make: the alternation test above proves a second BUILD lands in `.slot-b`.
    expect(existsSync(join(mirrorRoot({ data, root }), ".slot-b"))).toBe(false);
  });

  it("rebuilds as soon as the root moves to a new commit, and stamps the new one", () => {
    const { root, data, bin } = fixture();
    commitAll({ message: "one", root });
    runOnce({ bin, data, root });
    writeFileSync(join(root, "src", "sub", "added.ts"), "export {};\n");
    const next = commitAll({ message: "two", root });

    expect(runOnce({ bin, data, root })).not.toContain(MATCH_LINE);
    expect(currentTree({ data, root })).toEqual({ slot: ".slot-b", src: FILES_PER_DIR + 1, templates: FILES_PER_DIR });
    expect(readFileSync(stampOf({ data, root, slot: ".slot-b" }), "utf8")).toBe(`${next}\n`);
  });

  it("copies a tracked edit HEAD does not describe, and leaves that slot unstamped so the next boot copies again", () => {
    const { root, data, bin } = fixture();
    commitAll({ message: "one", root });
    runOnce({ bin, data, root });
    writeFileSync(join(root, "src", "sub", "s0.ts"), "edited");

    expect(runOnce({ bin, data, root })).not.toContain(MATCH_LINE);
    const current = join(mirrorRoot({ data, root }), "current");
    expect(readFileSync(join(current, "src", "sub", "s0.ts"), "utf8")).toBe("edited");
    expect(existsSync(stampOf({ data, root, slot: ".slot-b" }))).toBe(false);
    expect(runOnce({ bin, data, root })).not.toContain(MATCH_LINE);
    expect(readlinkSync(current)).toBe(".slot-a");
  });

  it("copies an untracked file, and an ignored one, because the copy takes both and HEAD names neither", () => {
    const { root, data, bin } = fixture();
    writeFileSync(join(root, ".gitignore"), "*.log\n");
    commitAll({ message: "one", root });
    runOnce({ bin, data, root });
    writeFileSync(join(root, "templates", "untracked.json"), "{}");
    runOnce({ bin, data, root });
    const current = join(mirrorRoot({ data, root }), "current");
    expect(readFileSync(join(current, "templates", "untracked.json"), "utf8")).toBe("{}");

    rmSync(join(root, "templates", "untracked.json"));
    runOnce({ bin, data, root });
    writeFileSync(join(root, "src", "sub", "ignored.log"), "noise");
    expect(runOnce({ bin, data, root })).not.toContain(MATCH_LINE);
    expect(readFileSync(join(current, "src", "sub", "ignored.log"), "utf8")).toBe("noise");
  });

  it("rebuilds a slot built before stamps existed, which carries none", () => {
    const { root, data, bin } = fixture();
    commitAll({ message: "one", root });
    runOnce({ bin, data, root });
    rmSync(stampOf({ data, root, slot: ".slot-a" }));
    expect(runOnce({ bin, data, root })).not.toContain(MATCH_LINE);
    expect(readlinkSync(join(mirrorRoot({ data, root }), "current"))).toBe(".slot-b");
  });

  it("never skips on the seed, even beside a slot whose stamp matches", () => {
    const { root, data, bin } = fixture();
    commitAll({ message: "one", root });
    runOnce({ bin, data, root });
    const current = join(mirrorRoot({ data, root }), "current");
    rmSync(current);
    symlinkSync(root, current);
    expect(runOnce({ bin, data, root })).not.toContain(MATCH_LINE);
    expect(readlinkSync(current)).toBe(".slot-a");
  });

  it("refreshes .last-sync on a skip, so a root that only ever skips is never pruned under a live seat", () => {
    const { root, data, bin } = fixture();
    commitAll({ message: "one", root });
    runOnce({ bin, data, root });
    const marker = join(mirrorRoot({ data, root }), ".last-sync");
    utimesSync(marker, LAST_BOOTED_A_MONTH_AGO, LAST_BOOTED_A_MONTH_AGO);
    expect(runOnce({ bin, data, root })).toContain(MATCH_LINE);
    expect(statSync(marker).mtimeMs).toBeGreaterThan(LAST_BOOTED_A_MONTH_AGO.getTime());
  });

  it("never stamps a root that is not a git checkout, so a cache install builds exactly as before", () => {
    const { root, data, bin } = fixture();
    runOnce({ bin, data, root });
    expect(runOnce({ bin, data, root })).not.toContain(MATCH_LINE);
    expect(existsSync(stampOf({ data, root, slot: ".slot-b" }))).toBe(false);
  });
});
