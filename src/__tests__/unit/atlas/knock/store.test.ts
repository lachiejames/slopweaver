import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type KnockAtlasPaths, knockAtlasPaths, withKnockPublishLock } from "../../../../atlas/knock/store.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-26T00:00:00.000Z";

let home: string;
let paths: KnockAtlasPaths;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-knock-store-"));
  paths = knockAtlasPaths({ home });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("withKnockPublishLock", () => {
  it("passes the wrapped publish's own value through when the lock is free", () => {
    expect(unwrap(withKnockPublishLock({ nowIso: AT, paths, publish: () => ok(42) }))).toBe(42);
  });

  it("refuses a nested publisher on the Knock atlas by name, and says nothing was written", () => {
    const nested = withKnockPublishLock({
      nowIso: AT,
      paths,
      publish: () => withKnockPublishLock({ nowIso: AT, paths, publish: () => ok("never reached") }),
    });
    expect(unwrapErr(nested)).toEqual([
      `another process is publishing the Knock atlas: held by pid ${String(process.pid)} since ${AT} (0ms old, ` +
        `under the 900000ms stale threshold, and the holder answered signal 0 — it was ALIVE when checked at ` +
        `${AT}, so this is contention rather than a lock left behind by a dead process)`,
      "nothing was written — run the verb again once it has finished",
    ]);
  });

  it("frees the lock after a publish that failed, so the next publisher runs", () => {
    expect(unwrapErr(withKnockPublishLock({ nowIso: AT, paths, publish: () => err(["refused"]) }))).toEqual([
      "refused",
    ]);
    expect(unwrap(withKnockPublishLock({ nowIso: AT, paths, publish: () => ok("next") }))).toBe("next");
  });
});
