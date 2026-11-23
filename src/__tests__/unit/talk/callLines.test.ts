/*
 * A call file read tolerantly: a torn line is skipped and counted, never the reason the whole call fails to read.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { readCallLines } from "../../../talk/callLines.js";
import type { CallEntry } from "../../../talk/callRecord.js";

const SAID: CallEntry = {
  atIso: "2026-09-25T02:21:00.000Z",
  final: true,
  id: "s-1",
  kind: "segment",
  text: "look at the staging pool",
  who: "owner",
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "call-lines-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("readCallLines", () => {
  it("keeps every line that parses, skips a blank one silently, and counts a torn or unknown one", () => {
    const path = join(dir, "call.jsonl");
    const unknown = JSON.stringify({ atIso: "2026-09-25T02:30:00.000Z", kind: "rename" });
    writeFileSync(path, `${JSON.stringify(SAID)}\n\n{"atIso":\n${unknown}\n`);
    expect(unwrap(readCallLines({ path }))).toEqual({ entries: [SAID], present: true, skipped: 2, stampsDropped: 0 });
  });

  // Each of these places a stretch in its run, so a dropped one is counted, never read as none.
  it("counts a kept segment line whose card, hand or start stamp was present and did not read", () => {
    const path = join(dir, "call.jsonl");
    const torn = [{ open: "?" }, { openBy: "owner" }, { beganIso: "soon" }, { open: "post:sd-11112222" }];
    writeFileSync(path, `${torn.map((stamp) => JSON.stringify({ ...SAID, ...stamp })).join("\n")}\n`);
    const read = unwrap(readCallLines({ path }));
    expect([read.entries.length, read.skipped, read.stampsDropped]).toEqual([4, 0, 3]);
  });

  it("fails a call file that is not there, rather than reading it as empty", () => {
    expect(unwrapErr(readCallLines({ path: join(dir, "absent.jsonl") }))).toMatchObject({ code: "ENOENT" });
  });
});
