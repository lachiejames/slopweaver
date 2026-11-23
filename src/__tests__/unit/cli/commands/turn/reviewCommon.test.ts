/**
 * The leaf both reading modes stand on: how a refusal is printed, and what `readReviewTruth` says when there
 * is no review on record at all.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { turnCommandErrorLines } from "../../../../../cli/commands/turn/errors.js";
import { readReviewTruth, refuse } from "../../../../../cli/commands/turn/reviewCommon.js";
import { unwrapErr } from "../../../../../lib/result.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-review-common-"));
  dirs.push(home);
  return home;
}

describe("refuse", () => {
  it("hands back the exit code it was given, whatever the reasons were", () => {
    expect(refuse({ code: 7, errors: ["first reason", "second reason"] })).toBe(7);
  });

  it("hands back the code with no reasons at all — an empty list is not a success", () => {
    expect(refuse({ code: 2, errors: [] })).toBe(2);
  });
});

describe("readReviewTruth", () => {
  it("names the ask and the remedy when no review was ever opened for it", async () => {
    const read = await readReviewTruth({
      askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
      home: emptyHome(),
    });
    expect(read.isErr()).toBe(true);
    expect(turnCommandErrorLines({ error: unwrapErr(read) })).toEqual([
      "no review has been opened for C1/1785000000.000100 — run turn review with --answer first",
    ]);
  });
});
