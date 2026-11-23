/**
 * `readProfileLoads` (`src/context/loadLedgerStore.ts`) over a real temp ledger: the empty tail every append leaves is
 * no row, and every other line that is not one — a blank or whitespace-only line, or one holding a byte that is not
 * UTF-8, included — is still counted.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readProfileLoads } from "../../../context/loadLedgerStore.js";
import { unwrap } from "../../../lib/result.js";

const ROW = JSON.stringify({
  atIso: "2026-10-31T10:00:00.000Z",
  cwd: "/w",
  event: "SessionStart:startup",
  origin: "none",
  reason: "no store",
  sessionId: "s-1",
  source: "hook",
});

describe("readProfileLoads", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "load-ledger-"));
    mkdirSync(join(home, "profile"), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Read a ledger holding exactly `body`, as row count and undecodable count. */
  function read({ body }: { body: string }): readonly number[] {
    writeFileSync(join(home, "profile", "loads.jsonl"), body);
    const loads = unwrap(readProfileLoads({ home }));
    return [loads.rows.length, loads.undecodable];
  }

  it("counts no damage for the empty tail after the last newline, nor for an empty file", () => {
    expect([read({ body: `${ROW}\n${ROW}\n` }), read({ body: "" })]).toEqual([
      [2, 0],
      [0, 0],
    ]);
  });

  it("still counts a whitespace-only line, a blank line between rows and a torn last line", () => {
    expect([read({ body: " " }), read({ body: `${ROW}\n\n${ROW}\n` }), read({ body: `${ROW}\n{"torn` })]).toEqual([
      [0, 1],
      [2, 1],
      [1, 1],
    ]);
  });

  it("counts a row holding a byte that is not UTF-8, rather than decoding its repaired text", () => {
    const [head, tail] = ROW.split("no store");
    const damaged = Buffer.concat([Buffer.from(`${head!}no`), Buffer.from([0x80]), Buffer.from(`store${tail!}\n`)]);
    writeFileSync(join(home, "profile", "loads.jsonl"), damaged);
    const loads = unwrap(readProfileLoads({ home }));
    expect([loads.rows.length, loads.undecodable]).toEqual([0, 1]);
  });
});
