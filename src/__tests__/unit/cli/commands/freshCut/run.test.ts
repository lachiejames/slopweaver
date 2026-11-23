/**
 * `fresh-cut produce|verify`'s shell, up to the first read: help exits clean, a bad flag set is a usage refusal, and a
 * verification of a record the home does not hold is an error before any git runs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FRESH_CUT_PRODUCE_USAGE, FRESH_CUT_VERIFY_USAGE } from "../../../../../cli/commands/freshCut/freshCutUsage.js";
import { runFreshCutProduce, runFreshCutVerify } from "../../../../../cli/commands/freshCut/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const RECORD_ID = "0b7e7f8e-1f4a-4c2b-9d3e-5a6b7c8d9e0f";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fresh-cut-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("fresh-cut usage lines", () => {
  it("name each verb's own command", () => {
    expect([
      FRESH_CUT_PRODUCE_USAGE.startsWith("usage: slopweaver fresh-cut produce --commit <sha> --out <absolute-dir>"),
      FRESH_CUT_VERIFY_USAGE.startsWith("usage: slopweaver fresh-cut verify --record <record-id>"),
    ]).toEqual([true, true]);
  });
});

describe("runFreshCutProduce", () => {
  it("exits clean on --help", async () => {
    expect(await runFreshCutProduce(["node", "slopweaver", "fresh-cut", "produce", "--help"])).toBe(EXIT_OK);
  });

  it("refuses a relative destination as a usage error, before reading any identity", async () => {
    expect(
      await runFreshCutProduce([
        "node",
        "slopweaver",
        "fresh-cut",
        "produce",
        "--commit",
        "7adba73",
        "--out",
        "cut",
        "--home",
        home,
      ]),
    ).toBe(EXIT_USAGE);
  });
});

describe("runFreshCutVerify", () => {
  it("exits clean on --help", () => {
    expect(runFreshCutVerify(["node", "slopweaver", "fresh-cut", "verify", "-h"])).toBe(EXIT_OK);
  });

  it("refuses a missing record as a usage error", () => {
    expect(runFreshCutVerify(["node", "slopweaver", "fresh-cut", "verify"])).toBe(EXIT_USAGE);
  });

  it("is an error when the home holds no record for that id", () => {
    expect(
      runFreshCutVerify(["node", "slopweaver", "fresh-cut", "verify", "--record", RECORD_ID, "--home", home]),
    ).toBe(EXIT_ERROR);
  });
});
