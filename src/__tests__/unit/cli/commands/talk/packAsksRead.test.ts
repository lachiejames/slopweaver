/*
 * `talk pack`'s asks half over a home this file minted: a board with no docs composes to no asks and no tags, and a
 * home with no `handover currency` reading yields proofs that say so rather than an empty verdict list.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readAsks, readProofs } from "../../../../../cli/commands/talk/packAsksRead.js";

let home = "";
let dir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pack-asks-read-"));
  dir = join(home, "handovers");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readProofs", () => {
  it("says no reading could be read when the home holds none", () => {
    const proofs = readProofs({ home });
    expect(proofs.kind).toBe("unread");
  });
});

describe("readAsks", () => {
  it("composes an empty board to no asks, no rows, no skipped docs and no tags", () => {
    const asks = readAsks({ dir, home, proofs: readProofs({ home }) });
    expect(asks).toEqual({
      asks: [],
      observedIso: expect.any(String),
      rows: [],
      skipped: undefined,
      tagsBySlug: new Map(),
    });
  });
});
