/**
 * The one write door's rules for a `tagged` event: refused onto a journal it cannot read whole, and refused as a
 * failed read-back when undecodable lines appear around its append. A
 * `mkdtempSync` round trip, as `rowEvent/transitions.test.ts` is, for the same reason.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { applyRowEvent, unreadableGrowth } from "../../../handover/rowEvent.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const AT = "2026-09-28T01:00:00.000Z";

const TAGGED: RunEvent = {
  atIso: AT,
  drop: [],
  kind: "tagged",
  set: [{ key: "impact", value: "high" }],
  why: "a test",
};

const STARTED: RunEvent = { atIso: AT, branch: "feat/x", docHash: "abc123", kind: "started" };

const dirs: string[] = [];

/** A throwaway runs directory, removed after the test that minted it. */
function runsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rowevent-tagged-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

describe("applyRowEvent on a `tagged` event", () => {
  it("refuses a tag onto a journal with an undecodable line, naming the tag as what it would not record", () => {
    const dir = runsDir();
    writeFileSync(join(dir, "a-row.jsonl"), `${JSON.stringify(STARTED)}\n{"kind":"tagged","atIs\n`, "utf8");
    const refused = unwrapErr(applyRowEvent({ event: TAGGED, runsDir: dir, slug: "a-row" }));
    expect(refused.code).toBe("JOURNAL_INCOMPLETE");
    expect(refused.message).toBe(
      "refusing to record a tag on a journal with undecodable line(s) 2 — one of them could be a tag this write repeats or contradicts",
    );
  });

  it("appends onto a started run and reads it back, leaving the run open", () => {
    const dir = runsDir();
    writeFileSync(join(dir, "a-row.jsonl"), `${JSON.stringify(STARTED)}\n`, "utf8");
    const written = unwrap(applyRowEvent({ event: TAGGED, runsDir: dir, slug: "a-row" }));
    expect(written.state.phase).toBe("open");
  });
});

describe("unreadableGrowth", () => {
  it("reports undecodable lines that appeared around a tag's append", () => {
    expect(unreadableGrowth({ after: 3, before: 1, event: TAGGED })).toBe(
      "2 undecodable line(s) appeared around the append, so this tag may sit beside one it contradicts",
    );
  });

  it("says nothing when the count did not grow", () => {
    expect(unreadableGrowth({ after: 1, before: 1, event: TAGGED })).toBe(undefined);
  });

  it("leaves every other kind to its own read-back", () => {
    expect(unreadableGrowth({ after: 3, before: 1, event: STARTED })).toBe(undefined);
  });
});
