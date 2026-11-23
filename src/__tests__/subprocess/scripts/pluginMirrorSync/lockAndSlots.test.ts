/**
 * The SessionStart mirror, proven against real concurrent processes rather than described.
 *
 * `scripts/plugin-mirror-sync.sh` is what keeps an already-open session's frozen hook commands resolvable
 * across a plugin version bump, so the property that matters is not "it copies a tree" but "whatever
 * `mirror/current` names is COMPLETE, no matter how many sessions boot at once". It was not: measured
 * once, a cmux restart resumed six seats together and every concurrent run derived the same target
 * slot from the same `current` symlink, so they rm-ed and rsync-ed one directory at each other —
 * `rm: .../mirror/a/templates: Directory not empty` on the seats' screens, and a `current` left pointing at
 * a slot holding 199 of 400 files underneath it.
 *
 * Every concurrency case below therefore asserts a POSITIVE witness that contention actually happened (the
 * contender's own skip line) alongside the absence of the `rm:` failure. A storm whose processes happened
 * not to overlap would satisfy the absence while proving nothing, so the absence alone is not evidence.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import {
  currentTree,
  envFor,
  FILES_PER_DIR,
  fixture,
  fixtureDirs,
  holdLock,
  LONG_DEAD,
  mirrorRoot,
  runOnce,
  SCRIPT,
  useFixtureCleanup,
} from "./harness.js";

useFixtureCleanup();

/**
 * Run `count` copies of the hook at the same time against one plugin-data root, the shape a cmux restart
 * produces. Backgrounded from one bash so they genuinely overlap; `execFileSync` could only serialise them.
 *
 * @param count how many seats are resuming together
 * @returns each run's exit status, and every line the whole storm wrote
 */
function storm({ root, data, bin, count }: { root: string; data: string; bin: string; count: number }): {
  statuses: readonly number[];
  noise: string;
} {
  const outDir = mkdtempSync(join(tmpdir(), "sw-storm-"));
  fixtureDirs.push(outDir);
  const launcher = `for i in $(seq 1 ${String(count)}); do ( bash "$0" >"${outDir}/out.$i" 2>&1; echo $? >"${outDir}/rc.$i" ) & done; wait`;
  execFileSync("bash", ["-c", launcher, SCRIPT], { encoding: "utf8", env: envFor({ bin, data, root }) });
  const statuses: number[] = [];
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    statuses.push(Number(readFileSync(join(outDir, `rc.${String(i)}`), "utf8").trim()));
    lines.push(readFileSync(join(outDir, `out.${String(i)}`), "utf8"));
  }
  return { noise: lines.join(""), statuses };
}

describe("plugin-mirror-sync.sh", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("survives six seats resuming at once, and says which of them stood down", () => {
    const { root, data, bin } = fixture();
    runOnce({ bin, data, root });
    const { statuses, noise } = storm({ bin, count: 6, data, root });
    expect(statuses).toEqual([0, 0, 0, 0, 0, 0]);
    expect(noise).toContain("another session is syncing the plugin mirror");
    expect(noise).not.toContain("rm:");
  });

  it("leaves current naming a COMPLETE tree after every storm, which is the damage the rm: line hid", () => {
    const { root, data, bin } = fixture();
    runOnce({ bin, data, root });
    // Three rounds, exactly as the reproduction ran them: the old script's incompleteness is probabilistic
    // (11 of 18 runs failed, and a round could come out whole by luck), so one round is a coin flip and
    // three is the shape that reddened reliably. Every round is measured, not just the last.
    // The slot is deliberately not asserted here — which one a round lands on depends on how many of its
    // six processes won the lock, and slot alternation has its own single-syncer test below.
    const counts: { templates: number; src: number }[] = [];
    for (let round = 0; round < 3; round += 1) {
      storm({ bin, count: 6, data, root });
      const tree = currentTree({ data, root });
      counts.push({ src: tree.src, templates: tree.templates });
    }
    expect(counts).toEqual([
      { src: FILES_PER_DIR, templates: FILES_PER_DIR },
      { src: FILES_PER_DIR, templates: FILES_PER_DIR },
      { src: FILES_PER_DIR, templates: FILES_PER_DIR },
    ]);
  });

  it("builds a mirror from nothing even when six seats race for it with no slot to fall back on", () => {
    const { root, data, bin } = fixture();
    const { statuses, noise } = storm({ bin, count: 6, data, root });
    expect(statuses).toEqual([0, 0, 0, 0, 0, 0]);
    expect(noise).toContain("another session is syncing the plugin mirror");
    expect(currentTree({ data, root }).templates).toBe(FILES_PER_DIR);
    expect(currentTree({ data, root }).src).toBe(FILES_PER_DIR);
  });

  it("still alternates slots when one session syncs at a time", () => {
    const { root, data, bin } = fixture();
    runOnce({ bin, data, root });
    expect(readlinkSync(join(mirrorRoot({ data, root }), "current"))).toBe(".slot-a");
    runOnce({ bin, data, root });
    expect(readlinkSync(join(mirrorRoot({ data, root }), "current"))).toBe(".slot-b");
  });

  it("stands down on a live holder's lock rather than waiting, when the mirror it already has is usable", () => {
    const { root, data, bin } = fixture();
    runOnce({ bin, data, root });
    const before = currentTree({ data, root });
    const lock = holdLock({ data, root });
    expect(runOnce({ bin, data, root })).toContain("another session is syncing the plugin mirror");
    expect(currentTree({ data, root })).toEqual(before);
    expect(existsSync(lock)).toBe(true);
  });

  it("breaks a lock old enough to prove its holder died, and releases its own", () => {
    const { root, data, bin } = fixture();
    mkdirSync(mirrorRoot({ data, root }), { recursive: true });
    const lock = holdLock({ data, root });
    utimesSync(lock, LONG_DEAD, LONG_DEAD);
    runOnce({ bin, data, root });
    expect(currentTree({ data, root })).toEqual({ slot: ".slot-a", src: FILES_PER_DIR, templates: FILES_PER_DIR });
    expect(existsSync(lock)).toBe(false);
  });

  it.each(["gnu", "bsd"] as const)("reads a lock's age under a %s stat, not just the one it grew up on", (flavour) => {
    const { root, data, bin } = fixture();
    mkdirSync(mirrorRoot({ data, root }), { recursive: true });
    const lock = holdLock({ data, root });
    utimesSync(lock, LONG_DEAD, LONG_DEAD);
    // The stale break is the one branch that reads an mtime at all, so it is the branch that reddens when
    // the wrong `stat` form is asked first. Under the gnu shim the pre-fix expression aborted here with
    // `File: unbound variable`, leaving no mirror. The shim answers from a supplied epoch rather than the
    // file, so what this proves is which form is asked and how the answer is parsed — the real read is the
    // unshimmed case above, and an earlier shim that delegated to `/usr/bin/stat` failed on the Linux runner
    // for exactly the reason these cases exist.
    runOnce({ bin, data, root, statFlavour: flavour });
    expect(currentTree({ data, root })).toEqual({ slot: ".slot-a", src: FILES_PER_DIR, templates: FILES_PER_DIR });
    expect(existsSync(lock)).toBe(false);
  });

  it("waits for a live holder when there is no mirror at all, then builds one", () => {
    const { root, data, bin } = fixture();
    const lock = holdLock({ data, root });
    const heldMs = 3_000;
    // Elapsed time is the witness, and the only one that separates the three possible behaviours: standing
    // down would leave no mirror at all, ignoring the lock would finish inside a single ~0.63s build, and
    // waiting cannot finish before the holder lets go. A lower bound, so ambient load only makes it truer.
    const startedAt = Date.now();
    // The releaser is backgrounded with its own fds closed and never waited on, because BOTH of those would
    // otherwise supply the elapsed time this test is trying to measure the script by: `execFileSync` returns
    // only once every writer to the captured pipe has closed it, so a releaser inheriting stderr keeps the
    // 3s on the clock even for a script that ignored the lock entirely and built immediately.
    const waited = `( sleep 3; rmdir "${lock}" ) >/dev/null 2>&1 & bash "$0" 2>&1 1>/dev/null`;
    const noise = execFileSync("bash", ["-c", waited, SCRIPT], { encoding: "utf8", env: envFor({ bin, data, root }) });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(heldMs);
    expect(noise).not.toContain("gave up");
    expect(currentTree({ data, root })).toEqual({ slot: ".slot-a", src: FILES_PER_DIR, templates: FILES_PER_DIR });
  });
});
