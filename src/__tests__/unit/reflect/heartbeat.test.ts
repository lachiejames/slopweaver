import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  HEARTBEAT_KEYS,
  type HeartbeatRow,
  heartbeatLine,
  heartbeatSchema,
  recordHeartbeat,
} from "../../../reflect/heartbeat.js";
import { reflectLedgerDir } from "../../../reflect/seen.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const row = (over: Partial<HeartbeatRow> = {}): HeartbeatRow => ({
  backlogged: 46,
  candidates: 51,
  couldNotVerify: ["door.jsonl is poisoned"],
  schemaVersion: 1,
  sources: [{ findings: 3, rowsRead: 2575, source: "run-journal" }],
  suppressed: 0,
  surfaced: 5,
  tsIso: "2026-08-28T05:00:00.000Z",
  windowFromIso: "2026-08-27T05:00:00.000Z",
  windowToIso: "2026-08-28T05:00:00.000Z",
  ...over,
});

describe("the frozen heartbeat schema", () => {
  it("accepts exactly the frozen key set and no other", () => {
    expect(Object.keys(heartbeatSchema.shape).toSorted()).toStrictEqual([...HEARTBEAT_KEYS].toSorted());
  });

  it("REFUSES a row carrying a key the freeze does not name", () => {
    const drifted = { ...row(), noteToSelf: "the free-form field that drifted to 180 keys last time" };
    expect(heartbeatSchema.safeParse(drifted).success).toBe(false);
  });

  it("refuses a row missing a required key", () => {
    const { surfaced, ...missing } = row();
    expect(surfaced).toBe(5);
    expect(heartbeatSchema.safeParse(missing).success).toBe(false);
  });

  it("refuses a negative count", () => {
    expect(heartbeatSchema.safeParse(row({ surfaced: -1 })).success).toBe(false);
  });

  it("refuses a source name it does not know", () => {
    const bad = { ...row(), sources: [{ findings: 1, rowsRead: 1, source: "astrology" }] };
    expect(heartbeatSchema.safeParse(bad).success).toBe(false);
  });
});

describe("heartbeatLine", () => {
  it("renders a valid row", () => {
    expect(JSON.parse(unwrap(heartbeatLine({ row: row() })))).toStrictEqual(row());
  });

  it("refuses to render a drifted row rather than writing it", () => {
    const drifted = { ...row(), extra: 1 } as unknown as HeartbeatRow;
    const rendered = heartbeatLine({ row: drifted });
    expect(unwrapErr(rendered)).toEqual([`heartbeat : Unrecognized key: "extra"`]);
  });
});

describe("recordHeartbeat", () => {
  it("writes one line per run, so a quiet day is not a missing day", () => {
    const home = mkdtempSync(join(tmpdir(), "reflect-heartbeat-"));
    fixtureDirs.push(home);
    recordHeartbeat({ home, row: row({ surfaced: 0 }) });
    recordHeartbeat({ home, row: row({ tsIso: "2026-08-29T05:00:00.000Z" }) });
    const text = readFileSync(join(reflectLedgerDir({ home }), "heartbeat.jsonl"), "utf8");
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });

  it("reports the line it wrote", () => {
    const home = mkdtempSync(join(tmpdir(), "reflect-heartbeat-"));
    fixtureDirs.push(home);
    expect(unwrap(recordHeartbeat({ home, row: row() }))).toBe(unwrap(heartbeatLine({ row: row() })));
  });
});
