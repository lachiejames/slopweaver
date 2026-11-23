/**
 * The permanent ignore registry's durability path: a real round-trip against a temp home, because this
 * function's whole job IS a filesystem effect — there is no pure core to extract it into and test instead.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { IgnoredAsk } from "../../../../live/ask/ignore.js";
import { appendIgnoredAsk, ignoredAsksPath, readIgnoredAsksText } from "../../../../live/ask/ignoreStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const ENTRY: IgnoredAsk = {
  channel: "C1",
  ignoredAtIso: "2026-08-12T00:00:00.000Z",
  messageTs: "1785000000.000100",
  reason: "the owner said this thread is closed",
  schemaVersion: 1,
};

describe("ignoredAsksPath", () => {
  it("resolves under live/slack/ignored-asks.jsonl beneath the given home", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ignore-"));
    fixtureDirs.push(home);

    expect(ignoredAsksPath({ home })).toBe(join(home, "live", "slack", "ignored-asks.jsonl"));
  });
});

describe("appendIgnoredAsk / readIgnoredAsksText", () => {
  it("creates the file and its parent directory when neither exists", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ignore-"));
    fixtureDirs.push(home);

    appendIgnoredAsk({ entry: ENTRY, home });

    expect(readIgnoredAsksText({ home })).toBe(`${JSON.stringify(ENTRY)}\n`);
  });

  it("appends rather than overwrites — one JSONL line per call, in call order", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ignore-"));
    fixtureDirs.push(home);
    const second: IgnoredAsk = { ...ENTRY, messageTs: "2" };

    appendIgnoredAsk({ entry: ENTRY, home });
    appendIgnoredAsk({ entry: second, home });

    expect(readIgnoredAsksText({ home })).toBe(`${JSON.stringify(ENTRY)}\n${JSON.stringify(second)}\n`);
  });

  it("reads an absent registry as the empty string, not an error", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ignore-"));
    fixtureDirs.push(home);

    expect(readIgnoredAsksText({ home })).toBe("");
  });
});
