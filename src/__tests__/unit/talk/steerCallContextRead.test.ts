/*
 * The read behind a typed steer's call clause, over a throwaway home: a spoken relay reads nothing, and a typed one
 * over a home with no call reads that there is none to follow.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { callContextAtDelivery } from "../../../talk/steerCallContextRead.js";

const NOW = "2026-10-03T10:00:00.000Z";

describe("callContextAtDelivery", () => {
  let home = "";
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads nothing for a spoken relay — the call is where it came from", () => {
    home = mkdtempSync(join(tmpdir(), "steer-ctx-"));
    expect(callContextAtDelivery({ home, nowIso: NOW, typed: false })).toEqual({ kind: "none" });
  });

  it("finds no call to follow in a home that holds none", () => {
    home = mkdtempSync(join(tmpdir(), "steer-ctx-"));
    expect(callContextAtDelivery({ home, nowIso: NOW, typed: true })).toEqual({ kind: "none" });
  });
});
