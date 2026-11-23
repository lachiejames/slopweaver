/*
 * One batch onto a call file: the call's own lines appended in place, moving its write time; reconnect steps alone
 * written through a staged copy that keeps the file's times, its `0600` mode and its torn-tail separator.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendCallBatch } from "../../../talk/callFileAppend.js";
import type { CallEntry } from "../../../talk/callRecord.js";

const SAID: CallEntry = {
  atIso: "2026-09-25T02:21:00.000Z",
  final: true,
  id: "s-1",
  kind: "segment",
  text: "look at the staging pool",
  who: "owner",
};
const STEP: CallEntry = {
  atIso: "2026-09-25T02:22:00.000Z",
  event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
  kind: "reconnect",
};
const RAN_AT = Date.parse("2026-09-25T02:21:00.000Z") / 1000;

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sw-call-append-"));
  path = join(dir, "a0000041-0000-4000-8000-000000000044.jsonl");
  writeFileSync(path, `${JSON.stringify(SAID)}\n`, { mode: 0o600 });
  utimesSync(path, RAN_AT, RAN_AT);
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("appendCallBatch", () => {
  it("appends the call's own lines in place, so the file's write time moves", () => {
    appendCallBatch({ entries: [{ ...SAID, id: "s-2", text: "and the pool size" }], path });

    expect(readFileSync(path, "utf8").trim().split("\n").length).toBe(2);
    expect(statSync(path).mtimeMs).toBeGreaterThan(RAN_AT * 1000);
  });

  it("writes reconnect steps alone keeping the file's times and mode, and leaves no staged copy", () => {
    appendCallBatch({ entries: [STEP], path });

    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(SAID)}\n${JSON.stringify(STEP)}\n`);
    expect(statSync(path).mtimeMs).toBe(RAN_AT * 1000);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["a0000041-0000-4000-8000-000000000044.jsonl"]);
  });

  it("puts a step after a newline when a torn append left the tail unterminated", () => {
    writeFileSync(path, `${JSON.stringify(SAID)}\n{"atIso":"torn`, { mode: 0o600 });
    utimesSync(path, RAN_AT, RAN_AT);

    appendCallBatch({ entries: [STEP], path });

    expect(readFileSync(path, "utf8").split("\n").at(-2)).toBe(JSON.stringify(STEP));
    expect(statSync(path).mtimeMs).toBe(RAN_AT * 1000);
  });

  it("writes nothing for an empty batch", () => {
    appendCallBatch({ entries: [], path });

    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(SAID)}\n`);
    expect(statSync(path).mtimeMs).toBe(RAN_AT * 1000);
  });
});
