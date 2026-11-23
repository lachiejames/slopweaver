/**
 * The data root's copy lock: one root copies at a time, and a root that cannot wait still resolves.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import {
  commitAll,
  currentTree,
  envFor,
  FILES_PER_DIR,
  fixture,
  fixtureDirs,
  mirrorRoot,
  runOnce,
  SCRIPT,
  useFixtureCleanup,
} from "./harness.js";

useFixtureCleanup();

/** The data root's copy lock, which every plugin root booting against that data root shares. */
function holdCopyLock({ data }: { data: string }): string {
  const lock = join(data, "mirror", ".copy.lock");
  mkdirSync(lock, { recursive: true });
  return lock;
}

/** A reserve as large as the whole hook budget, so the first sight of a held copy lock is a give-up. */
const NO_TIME_TO_WAIT = { SLOPWEAVER_MIRROR_COPY_RESERVE_SECONDS: "55" };

describe("one copy per data root at a time", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("points a checkout at itself rather than a slot from an older commit when it cannot copy", () => {
    const { root, data, bin } = fixture();
    commitAll({ message: "one", root });
    runOnce({ bin, data, root });
    writeFileSync(join(root, "scripts", "added.sh"), "#!/bin/sh\n");
    commitAll({ message: "two", root });
    holdCopyLock({ data });

    expect(runOnce({ bin, data, extraEnv: NO_TIME_TO_WAIT, root })).toContain(
      "another root held the plugin mirror copy lock",
    );
    // The file `.slot-a` never had is what an older slot would have answered 127 for.
    expect(readlinkSync(join(mirrorRoot({ data, root }), "current"))).toBe(root);
    expect(existsSync(join(mirrorRoot({ data, root }), "current", "scripts", "added.sh"))).toBe(true);
    expect(existsSync(join(mirrorRoot({ data, root }), ".slot-b"))).toBe(false);
  });

  it("leaves a cache install on the slot it has, since its versioned key means the same bytes", () => {
    const { root, data, bin } = fixture();
    runOnce({ bin, data, root });
    holdCopyLock({ data });
    expect(runOnce({ bin, data, extraEnv: NO_TIME_TO_WAIT, root })).toContain(
      "another root held the plugin mirror copy lock",
    );
    expect(readlinkSync(join(mirrorRoot({ data, root }), "current"))).toBe(".slot-a");
  });

  it("waits for another root's copy to finish, then builds its own", () => {
    const { root, data, bin } = fixture();
    const lock = holdCopyLock({ data });
    const startedAt = Date.now();
    // Same shape as the per-root wait above: the releaser closes its fds so only the script is on the clock.
    const waited = `( sleep 3; rmdir "${lock}" ) >/dev/null 2>&1 & bash "$0" 2>&1 1>/dev/null`;
    const noise = execFileSync("bash", ["-c", waited, SCRIPT], { encoding: "utf8", env: envFor({ bin, data, root }) });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3_000);
    expect(noise).toContain("waiting for another root's plugin mirror copy");
    expect(currentTree({ data, root })).toEqual({ slot: ".slot-a", src: FILES_PER_DIR, templates: FILES_PER_DIR });
    expect(existsSync(lock)).toBe(false);
  });

  it("builds four different roots booting together one at a time, each COMPLETE", () => {
    const base = mkdtempSync(join(tmpdir(), "sw-roots-"));
    fixtureDirs.push(base);
    const roots = [1, 2, 3, 4].map((n) => fixture({ under: join(base, `r${String(n)}`) }).root);
    const data = join(base, "data");
    const bin = join(base, "bin");
    const launcher = roots
      .map(
        (r, i) =>
          `( PLUGIN_ROOT="${r}" bash "$0" >"${base}/out.${String(i)}" 2>&1; echo $? >"${base}/rc.${String(i)}" ) &`,
      )
      .concat(["wait"])
      .join("\n");
    execFileSync("bash", ["-c", launcher, SCRIPT], { encoding: "utf8", env: envFor({ bin, data, root: roots[0]! }) });

    const statuses = roots.map((_, i) => Number(readFileSync(join(base, `rc.${String(i)}`), "utf8").trim()));
    const noise = roots.map((_, i) => readFileSync(join(base, `out.${String(i)}`), "utf8")).join("");
    expect(statuses).toEqual([0, 0, 0, 0]);
    expect(noise).toContain("waiting for another root's plugin mirror copy");
    expect(roots.map((root) => currentTree({ data, root }))).toEqual(
      roots.map(() => ({ slot: ".slot-a", src: FILES_PER_DIR, templates: FILES_PER_DIR })),
    );
  });
});
