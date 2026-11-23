/**
 * `acquireWaitingLock` over a throwaway home: a free lock is taken, a held one is refused after its bounded
 * wait, and a released one is taken again.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { acquireWaitingLock } from "../../../../live/automation/waitingLock.js";

const KEY = "recipe-definition-holds";
const NOW = "2026-09-29T17:00:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "waiting-lock-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("acquireWaitingLock", () => {
  it("takes a free lock, refuses a second taker while it is held, and hands it over once released", () => {
    const first = unwrap(acquireWaitingLock({ home, key: KEY, nowIso: NOW }));

    const second = acquireWaitingLock({ home, key: KEY, nowIso: NOW });
    expect(second.isErr()).toBe(true);
    expect(unwrapErr(second)).toContain(`held by pid ${String(process.pid)}`);

    first.release();
    const third = unwrap(acquireWaitingLock({ home, key: KEY, nowIso: NOW }));
    third.release();
  });
});
