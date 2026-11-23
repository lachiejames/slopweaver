import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readStandingHold } from "../../../../../cli/commands/github/lapPreflightReads.js";
import { mergeHoldPath } from "../../../../../outbound/github/mergeHoldStore.js";

describe("readStandingHold", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      chmodSync(mergeHoldPath({ home }), 0o600);
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A home whose hold document holds `acme/widget` for another session, written to disk. */
  const homeWithHold = (): string => {
    const home = mkdtempSync(join(tmpdir(), "sw-lap-hold-"));
    homes.push(home);
    const path = mergeHoldPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    const hold = { atIso: "2026-11-11T00:00:00.000Z", holder: "other", pr: 99, repo: "acme/widget", why: "w" };
    writeFileSync(path, `${JSON.stringify({ holds: [hold], version: 1 })}\n`);
    return home;
  };

  it("answers clear when the home has no hold document at all", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-lap-hold-"));
    try {
      expect(readStandingHold({ home, slug: "acme/widget" })).toEqual({ kind: "clear" });
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("names the holder of a hold document it can read", () => {
    expect(readStandingHold({ home: homeWithHold(), slug: "Acme/Widget" })).toEqual({ holder: "other", kind: "held" });
  });

  it("answers unreadable, never clear, when the document cannot be read", () => {
    const home = homeWithHold();
    chmodSync(mergeHoldPath({ home }), 0o000);
    const read = readStandingHold({ home, slug: "acme/widget" });
    expect(read.kind).toBe("unreadable");
    expect(JSON.stringify(read)).toContain("EACCES");
  });
});
