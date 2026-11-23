import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { laterLedgerDir, laterPressed, rememberLaterPresses } from "../../../hand/laterPresses.js";
import { unwrap } from "../../../lib/result.js";

const NOW = "2026-10-02T04:45:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "later-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/* Remember `pressed` against the open set `open`, pruning unless told not to. */
function remember({
  pressed,
  open,
  prune = true,
}: {
  pressed: readonly string[];
  open: readonly string[];
  prune?: boolean;
}): ReturnType<typeof rememberLaterPresses> {
  return rememberLaterPresses({ home, nowIso: NOW, open: new Set(open), pressed, prune });
}

describe("laterPressed", () => {
  it("reads an install that never pressed Later as none", () => {
    expect([...unwrap(laterPressed({ home }))]).toEqual([]);
  });
});

describe("rememberLaterPresses", () => {
  it("remembers a Later on an open step, and not one on a step already settled", () => {
    expect(remember({ open: ["mon-prep-a"], pressed: ["mon-prep-a", "mon-prep-gone"] })).toEqual({
      problems: [],
      unrecorded: new Set(),
    });
    expect([...unwrap(laterPressed({ home }))]).toEqual(["mon-prep-a"]);
  });

  it("drops a remembered Later once its step leaves the register", () => {
    remember({ open: ["mon-prep-a"], pressed: ["mon-prep-a"] });
    remember({ open: [], pressed: [] });
    expect([...unwrap(laterPressed({ home }))]).toEqual([]);
  });

  it("keeps a remembered Later when the register skipped a line, since the step may be on it", () => {
    remember({ open: ["mon-prep-a"], pressed: ["mon-prep-a"] });
    remember({ open: [], pressed: [], prune: false });
    expect([...unwrap(laterPressed({ home }))]).toEqual(["mon-prep-a"]);
  });

  it("names a press it could not write, so the caller keeps its marker", () => {
    const ledger = laterLedgerDir({ home });
    mkdirSync(dirname(ledger), { recursive: true });
    writeFileSync(ledger, "not a directory");
    const remembered = remember({ open: ["mon-prep-a"], pressed: ["mon-prep-a"], prune: false });
    expect([...remembered.unrecorded]).toEqual(["mon-prep-a"]);
    expect(remembered.problems.map((problem) => problem.code)).toEqual(["LATER_LEDGER"]);
  });
});
