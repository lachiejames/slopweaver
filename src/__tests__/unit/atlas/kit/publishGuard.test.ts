/**
 * The opt-in publish lock, through the REAL operation lock in a temporary home: it serialises an expensive
 * read-and-publish, a second acquisition of the same key inside the stale threshold is refused even from this
 * same process, and it is released however the publish ends. Past the threshold the operation lock takes over a
 * holder whatever its liveness — that is `admit/operationLock.ts`'s contract, tested there, not this wrapper's.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import { withAtlasPublishLock } from "../../../../atlas/kit/publishGuard.js";

const AT = "2026-09-14T00:00:00.000Z";
const KEY = "atlas:notion:publish";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "publish-guard-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("withAtlasPublishLock", () => {
  it("returns whatever the publish returned, and releases the lock so the next publish is admitted", () => {
    const result = withAtlasPublishLock({ home, key: KEY, nowIso: AT, platform: "notion", publish: () => ok(42) });
    const next = withAtlasPublishLock({ home, key: KEY, nowIso: AT, platform: "notion", publish: () => ok("next") });

    expect(unwrap(result)).toBe(42);
    expect(unwrap(next)).toBe("next");
  });

  it("refuses a second publish of the same key at the same instant, naming the busy atlas, and runs nothing", () => {
    let innerRan = false;
    const outer = withAtlasPublishLock({
      home,
      key: KEY,
      nowIso: AT,
      platform: "notion",
      publish: () =>
        ok(
          withAtlasPublishLock({
            home,
            key: KEY,
            nowIso: AT,
            platform: "notion",
            publish: () => {
              innerRan = true;
              return ok("inner");
            },
          }),
        ),
    });

    const lines = unwrapErr(unwrap(outer));
    expect(innerRan).toBe(false);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("another process is publishing the notion atlas: ");
    expect(lines[0]).toContain(`held by pid ${String(process.pid)}`);
    expect(lines[1]).toBe("nothing was written — run the verb again once it has finished");
  });

  it("releases the lock after a publish that failed, so the next publish is admitted", () => {
    const failed = withAtlasPublishLock({
      home,
      key: KEY,
      nowIso: AT,
      platform: "notion",
      publish: () => err(["the read was refused"]),
    });
    const next = withAtlasPublishLock({ home, key: KEY, nowIso: AT, platform: "notion", publish: () => ok("next") });

    expect(unwrapErr(failed)).toEqual(["the read was refused"]);
    expect(unwrap(next)).toBe("next");
  });

  it("releases the lock after a publish that threw, and lets the throw through", () => {
    expect(() =>
      withAtlasPublishLock({
        home,
        key: KEY,
        nowIso: AT,
        platform: "notion",
        publish: () => {
          throw new Error("disk full");
        },
      }),
    ).toThrow("disk full");
    const next = withAtlasPublishLock({ home, key: KEY, nowIso: AT, platform: "notion", publish: () => ok("next") });

    expect(unwrap(next)).toBe("next");
  });

  it("does not serialise two different keys", () => {
    const outer = withAtlasPublishLock({
      home,
      key: KEY,
      nowIso: AT,
      platform: "notion",
      publish: () =>
        withAtlasPublishLock({
          home,
          key: "atlas:trelica:publish",
          nowIso: AT,
          platform: "trelica",
          publish: () => ok("both held"),
        }),
    });

    expect(unwrap(outer)).toBe("both held");
  });
});
