/**
 * The hygiene document writer over a throwaway home — the real atomic write, read back byte for byte.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { liveHygienePaths } from "../../../../live/hygiene/paths.js";
import { writeHygieneDocument } from "../../../../live/hygiene/reportStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A fresh home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "hyg-"));
  homes.push(home);
  return home;
}

describe("liveHygienePaths", () => {
  it("resolves every document under the root the state home hands in", () => {
    expect(liveHygienePaths({ root: "/h/live/hygiene" })).toEqual({
      cycleReconcile: "/h/live/hygiene/cycle-reconcile.json",
      githubLanding: "/h/live/hygiene/github-landing.json",
      root: "/h/live/hygiene",
      sweepBoard: "/h/live/hygiene/sweep-board.jsonl",
      sweepBoardCensus: "/h/live/hygiene/sweep-board-census.json",
    });
  });

  it("is what stateHomePaths carries at live.hygiene", () => {
    expect(stateHomePaths({ home: "/h" }).live.hygiene.sweepBoard).toBe("/h/live/hygiene/sweep-board.jsonl");
  });
});

describe("writeHygieneDocument", () => {
  it("creates the document owner-only, with exactly the chunks it was handed", () => {
    const path = stateHomePaths({ home: freshHome() }).live.hygiene.cycleReconcile;
    expect(unwrap(writeHygieneDocument({ chunks: ['{"a":1}', "\n"], path }))).toBe(path);
    expect(readFileSync(path, "utf8")).toBe('{"a":1}\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
  });

  it("replaces an existing document whole", () => {
    const path = stateHomePaths({ home: freshHome() }).live.hygiene.sweepBoard;
    unwrap(writeHygieneDocument({ chunks: ["old line one\n", "old line two\n"], path }));
    unwrap(writeHygieneDocument({ chunks: ["new\n"], path }));
    expect(readFileSync(path, "utf8")).toBe("new\n");
  });

  it("writes a zero-byte document for an empty pass, which is an answer rather than an absence", () => {
    const path = stateHomePaths({ home: freshHome() }).live.hygiene.sweepBoard;
    unwrap(writeHygieneDocument({ chunks: ["a finding\n"], path }));
    unwrap(writeHygieneDocument({ chunks: [], path }));
    expect(readFileSync(path, "utf8")).toBe("");
  });

  it("leaves the previous document standing when the producer throws part-way", () => {
    const path = stateHomePaths({ home: freshHome() }).live.hygiene.githubLanding;
    unwrap(writeHygieneDocument({ chunks: ["yesterday\n"], path }));
    function* failing(): Generator<string> {
      yield "half of today";
      throw new Error("the producer broke");
    }
    const failed = writeHygieneDocument({ chunks: failing(), path });
    expect(unwrapErr(failed)).toEqual([
      `hygiene document ${path} was not replaced, and the previous one stands: the producer broke`,
    ]);
    expect(readFileSync(path, "utf8")).toBe("yesterday\n");
  });

  it("refuses when the path is occupied by a directory, and leaves that directory's contents alone", () => {
    const path = stateHomePaths({ home: freshHome() }).live.hygiene.githubLanding;
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "kept"), "kept", "utf8");
    const failed = writeHygieneDocument({ chunks: ["{}"], path });
    expect(unwrapErr(failed)[0]).toContain(`hygiene document ${path} was not replaced, and the previous one stands:`);
    expect(readFileSync(join(path, "kept"), "utf8")).toBe("kept");
  });
});
