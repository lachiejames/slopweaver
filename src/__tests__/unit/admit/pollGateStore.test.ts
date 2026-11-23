/**
 * The poll record on disk: a genuine round-trip through a temp home, the change token beside each instant, the
 * ten-minute prune, the pre-token record shape, and the fail-open reads.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { pollGatePath, readPollRecord, recordPoll } from "../../../admit/pollGateStore.js";
import { dyingAtomicWriter } from "../../dyingAtomicWriter.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh Slopweaver home. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-poll-gate-"));
  homes.push(home);
  return home;
}

describe("pollGatePath", () => {
  it("names one file per session under live/poll-gate", () => {
    expect(pollGatePath({ home: "/h", sessionId: "abc-123" })).toBe("/h/live/poll-gate/abc-123.json");
  });

  it("reduces a hostile session id to a safe filename", () => {
    expect(pollGatePath({ home: "/h", sessionId: "../../etc/passwd" })).toBe("/h/live/poll-gate/______etc_passwd.json");
  });

  it("falls back to unknown for an empty id", () => {
    expect(pollGatePath({ home: "/h", sessionId: "" })).toBe("/h/live/poll-gate/unknown.json");
  });
});

describe("recordPoll and readPollRecord", () => {
  it("round-trips a target and its change token through the file", () => {
    const path = pollGatePath({ home: tempHome(), sessionId: "s1" });
    recordPoll({ fingerprint: "a.log\u000012\u00004000", nowMs: 5_000, path, target: "/tmp/a.log" });
    expect([...readPollRecord({ path })]).toEqual([
      ["/tmp/a.log", { atMs: 5_000, fingerprint: "a.log\u000012\u00004000" }],
    ]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      seen: { "/tmp/a.log": { atMs: 5_000, fingerprint: "a.log\u000012\u00004000" } },
    });
  });

  it("writes no token key for a target that has none", () => {
    const path = pollGatePath({ home: tempHome(), sessionId: "s1" });
    recordPoll({ fingerprint: undefined, nowMs: 5_000, path, target: "pid:1" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ seen: { "pid:1": { atMs: 5_000 } } });
  });

  it("overwrites the same target with the later instant and token, and keeps the others", () => {
    const path = pollGatePath({ home: tempHome(), sessionId: "s1" });
    recordPoll({ fingerprint: "v1", nowMs: 1_000, path, target: "/tmp/b.log" });
    recordPoll({ fingerprint: undefined, nowMs: 2_000, path, target: "task:x" });
    recordPoll({ fingerprint: "v2", nowMs: 3_000, path, target: "/tmp/b.log" });
    expect(new Map(readPollRecord({ path }))).toEqual(
      new Map([
        ["task:x", { atMs: 2_000 }],
        ["/tmp/b.log", { atMs: 3_000, fingerprint: "v2" }],
      ]),
    );
  });

  it("prunes entries older than ten minutes on write", () => {
    const path = pollGatePath({ home: tempHome(), sessionId: "s1" });
    recordPoll({ fingerprint: undefined, nowMs: 0, path, target: "old" });
    recordPoll({ fingerprint: undefined, nowMs: 10 * 60_000 + 1, path, target: "new" });
    expect([...readPollRecord({ path })]).toEqual([["new", { atMs: 10 * 60_000 + 1 }]]);
  });

  it("keeps the old record whole when a rewrite dies part-way, and leaves no staged sibling", () => {
    const path = pollGatePath({ home: tempHome(), sessionId: "s1" });
    recordPoll({ fingerprint: undefined, nowMs: 1_000, path, target: "pid:1" });
    const before = readFileSync(path, "utf8");

    recordPoll({ fingerprint: undefined, nowMs: 2_000, path, target: "task:x", writeAtomic: dyingAtomicWriter });

    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readdirSync(dirname(path))).toEqual(["s1.json"]);
  });

  it("reads an absent file as empty", () => {
    expect(readPollRecord({ path: pollGatePath({ home: tempHome(), sessionId: "none" }) }).size).toBe(0);
  });

  it("reads a record written before change tokens existed as instants with no token", () => {
    const path = pollGatePath({ home: tempHome(), sessionId: "legacy" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ seen: { "/tmp/c.log": 7_000 } }), "utf8");
    expect([...readPollRecord({ path })]).toEqual([["/tmp/c.log", { atMs: 7_000 }]]);
  });

  it("keeps a legacy entry across a later write, pruned by its own instant", () => {
    const path = pollGatePath({ home: tempHome(), sessionId: "legacy" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ seen: { "/tmp/c.log": 7_000 } }), "utf8");
    recordPoll({ fingerprint: "t", nowMs: 8_000, path, target: "/tmp/d.log" });
    expect(new Map(readPollRecord({ path }))).toEqual(
      new Map([
        ["/tmp/c.log", { atMs: 7_000 }],
        ["/tmp/d.log", { atMs: 8_000, fingerprint: "t" }],
      ]),
    );
  });

  it("reads a malformed file as empty, and drops entries with no usable instant", () => {
    const path = pollGatePath({ home: tempHome(), sessionId: "bad" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json", "utf8");
    expect(readPollRecord({ path }).size).toBe(0);
    writeFileSync(
      path,
      JSON.stringify({ seen: { a: "soon", b: 7, c: { atMs: "x" }, d: { fingerprint: "f" } } }),
      "utf8",
    );
    expect([...readPollRecord({ path })]).toEqual([["b", { atMs: 7 }]]);
  });

  it("drops a token that is not a string and keeps the instant", () => {
    const path = pollGatePath({ home: tempHome(), sessionId: "bad" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ seen: { e: { atMs: 9, fingerprint: 42 } } }), "utf8");
    expect([...readPollRecord({ path })]).toEqual([["e", { atMs: 9 }]]);
  });
});
