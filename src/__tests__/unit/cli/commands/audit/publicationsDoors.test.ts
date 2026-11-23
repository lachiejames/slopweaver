/**
 * The production doors of `audit publications` over a throwaway home holding no credential and no write record: each
 * door answers from the state home alone, reads nothing off the machine, and says which gap that leaves. Linear's token
 * variables are cleared for each case and restored after, so an operator's exported key cannot send a case to the wire.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CREDENTIAL_MISSING,
  productionReadLinear,
  productionReadNotion,
  productionReadSlack,
} from "../../../../../cli/commands/audit/publicationsDoors.js";
import { LINEAR_PUBLICATION_GAPS } from "../../../../../live/publicationAudit/linearSeam.js";

const LINEAR_TOKEN_VARIABLES = ["LINEAR_API_KEY", "LINEAR_TOKEN"] as const;

let home: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pubdoors-"));
  saved = {};
  for (const name of LINEAR_TOKEN_VARIABLES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  for (const name of LINEAR_TOKEN_VARIABLES) {
    const value = saved[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("productionReadLinear", () => {
  it("reads nothing with no token, and is partial on the credential and the uninventoried uploads", async () => {
    const read = await productionReadLinear({ home });

    expect(read.texts).toEqual([]);
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "linear",
      gaps: [LINEAR_PUBLICATION_GAPS.attachmentWritesNotInventoried, CREDENTIAL_MISSING],
      objects: 0,
      state: "partial",
      texts: 0,
    });
  });
});

describe("productionReadNotion", () => {
  it("is complete with nothing read when the page ledger is empty, before any token is looked for", async () => {
    const read = await productionReadNotion({ home });

    expect(read.texts).toEqual([]);
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "notion",
      gaps: [],
      objects: 0,
      state: "complete",
      texts: 0,
    });
  });
});

describe("productionReadSlack", () => {
  it("reads no message when the placement journal names none", async () => {
    const read = await productionReadSlack({ home });

    expect(read.texts).toEqual([]);
    expect(read.coverage.door).toBe("slack");
    expect(read.coverage.objects).toBe(0);
    expect(read.coverage.texts).toBe(0);
  });
});

describe("CREDENTIAL_MISSING", () => {
  it("is the fixed gap label a door with no credential reports", () => {
    expect(CREDENTIAL_MISSING).toBe("credential missing");
  });
});
