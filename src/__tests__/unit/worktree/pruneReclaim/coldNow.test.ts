/*
 * `coldNow`, the drop-time re-check: a present tree no live register names and past the threshold passes, and a tree
 * taken, stood beneath, touched or gone fails.
 */
import { mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { worktreePathKey } from "../../../../worktree/location.js";
import { coldNow } from "../../../../worktree/pruneDeps.js";
import { dir, useReclaimDir, verdictFor } from "./harness.js";

useReclaimDir();

describe("coldNow", () => {
  const DAY = 86_400_000;

  it("passes a present tree no live register names and whose stamp is older than the threshold", () => {
    const path = join(dir, "cold");
    mkdirSync(path);
    utimesSync(path, new Date(0), new Date(0));

    expect(coldNow({ live: new Map(), nowMs: 2 * DAY, olderThanMs: DAY })({ verdict: verdictFor({ path }) })).toBe(
      true,
    );
  });

  it("fails a tree a live session took after the scan", () => {
    const path = join(dir, "taken");
    mkdirSync(path);
    utimesSync(path, new Date(0), new Date(0));
    const live = new Map([[worktreePathKey({ path }), ["session abc"]]]);

    expect(coldNow({ live, nowMs: 2 * DAY, olderThanMs: DAY })({ verdict: verdictFor({ path }) })).toBe(false);
  });

  it("fails a tree a live workspace stands BENEATH, in a subdirectory of it", () => {
    const path = join(dir, "nested");
    mkdirSync(path);
    utimesSync(path, new Date(0), new Date(0));
    const live = new Map([[worktreePathKey({ path: join(path, "apps", "web") }), ["live workspace workspace:3"]]]);

    expect(coldNow({ live, nowMs: 2 * DAY, olderThanMs: DAY })({ verdict: verdictFor({ path }) })).toBe(false);
  });

  it("fails a tree touched inside the threshold, and one gone from disk", () => {
    const path = join(dir, "warm");
    mkdirSync(path);
    const check = coldNow({ live: new Map(), nowMs: Date.now(), olderThanMs: DAY });

    expect(check({ verdict: verdictFor({ path }) })).toBe(false);
    expect(check({ verdict: verdictFor({ path: join(dir, "absent") }) })).toBe(false);
  });
});
