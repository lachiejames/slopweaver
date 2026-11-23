/**
 * The Codex-thread observer scans at most once, on its first question, and judges every question off that one scan.
 */
import { describe, expect, it } from "vitest";

import { codexThreadObserver } from "../../../measurement/codexOpenFiles.js";
import type { CodexOpenFilesScan } from "../../../measurement/codexSessions.js";

const THREAD = "a0000065-0000-4000-8000-000000000071";
const OTHER = "0199ffff-0000-7111-8222-333344445555";
const HOME = "/Users/acme/.codex";
const LOCK = `${HOME}/thread-writer-locks/${THREAD}.lock`;

/** A scan seam that counts its own runs — a plain fake, not a mock. */
function countingScan(): { readonly read: () => CodexOpenFilesScan; readonly runs: () => number } {
  let runs = 0;
  return {
    read: () => {
      runs += 1;
      return { files: [{ command: "codex", path: LOCK, pid: 41 }], homes: [HOME], kind: "read" };
    },
    runs: () => runs,
  };
}

describe("codexThreadObserver", () => {
  it("never scans when nothing asks", () => {
    const scan = countingScan();
    codexThreadObserver({ read: scan.read });
    expect(scan.runs()).toBe(0);
  });

  it("scans once for many questions and answers each off that scan", () => {
    const scan = countingScan();
    const observe = codexThreadObserver({ read: scan.read });
    expect(observe({ threadId: THREAD })).toEqual({ kind: "live", path: LOCK, pid: 41 });
    expect(observe({ threadId: OTHER }).kind).toBe("not-observed");
    expect(scan.runs()).toBe(1);
  });

  it("keeps a failed scan as the answer rather than scanning again", () => {
    let runs = 0;
    const observe = codexThreadObserver({
      read: () => {
        runs += 1;
        return { kind: "failed", why: "lsof ended with exit 2" };
      },
    });
    expect(observe({ threadId: THREAD })).toEqual({
      kind: "not-observed",
      why: "Codex's open files could not be read — lsof ended with exit 2",
    });
    expect(observe({ threadId: THREAD }).kind).toBe("not-observed");
    expect(runs).toBe(1);
  });
});
