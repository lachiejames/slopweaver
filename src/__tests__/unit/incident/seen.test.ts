import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSeenRow, parseSeenRow, readSeenChannelIds } from "../../../incident/seen.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

const ROW = {
  atIso: "2026-10-04T05:00:00.000Z",
  channelId: "C0INC",
  outcome: "created",
  slug: "incident-x-c0inc",
} as const;

describe("parseSeenRow", () => {
  it("reads a whole row", () => {
    expect(unwrap(parseSeenRow({ line: JSON.stringify(ROW), lineNumber: 1 }))).toEqual(ROW);
  });

  it("refuses a line that is not JSON, naming its line", () => {
    const error = unwrapErr(parseSeenRow({ line: "{", lineNumber: 7 }));
    expect(error.code).toBe("LEDGER_CORRUPT");
    expect(error.message).toContain("line 7: it is not JSON");
  });

  it("refuses an outcome outside the closed set", () => {
    const error = unwrapErr(parseSeenRow({ line: JSON.stringify({ ...ROW, outcome: "maybe" }), lineNumber: 2 }));
    expect(error.code).toBe("LEDGER_CORRUPT");
    expect(error.message).toContain("created | created-incomplete | already-existed");
  });
});

describe("the seen ledger on disk", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "incident-seen-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads an ABSENT ledger as empty", () => {
    expect([...unwrap(readSeenChannelIds({ home }))]).toEqual([]);
  });

  it("round-trips appended rows, owner-only", () => {
    unwrap(appendSeenRow({ home, row: ROW }));
    const path = unwrap(appendSeenRow({ home, row: { ...ROW, channelId: "C0TWO", outcome: "already-existed" } }));

    expect([...unwrap(readSeenChannelIds({ home }))]).toEqual(["C0INC", "C0TWO"]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("refuses a PRESENT ledger with a corrupt line rather than reading it as empty", () => {
    const paths = stateHomePaths({ home });
    mkdirSync(paths.incidents, { recursive: true });
    writeFileSync(paths.incidentsSeenJsonl, `${JSON.stringify(ROW)}\nnot json\n`);

    const error = unwrapErr(readSeenChannelIds({ home }));
    expect(error.code).toBe("LEDGER_CORRUPT");
    expect(error.message).toContain("line 2");
  });
});
