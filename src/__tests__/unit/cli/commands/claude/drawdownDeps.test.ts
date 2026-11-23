/**
 * The drawdown pass's real journal, reached through the production dependencies `claude watch` injects: an
 * event appended reads back, and a journal that cannot be read or written reports one line saying so. The
 * investigation spawn is not exercised here — it opens a visible cmux workspace.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DrawdownSample } from "../../../../../claude/drawdownAnomaly.js";
import { PRODUCTION_DRAWDOWN_DEPS } from "../../../../../cli/commands/claude/drawdownDeps.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SAMPLE: DrawdownSample = {
  kind: "sample",
  observedAtIso: "2026-09-10T12:00:00.000Z",
  planAlias: "plan-a",
  resetAtIso: "2026-09-10T18:00:00.000Z",
  schemaVersion: 1,
  utilization: 0.25,
  window: "five-hour",
};

const homes: string[] = [];

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "drawdown-deps-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("PRODUCTION_DRAWDOWN_DEPS", () => {
  it("reads back an event it appended", () => {
    const home = freshHome();
    expect(unwrap(PRODUCTION_DRAWDOWN_DEPS.appendJournal({ events: [SAMPLE], home }))).toBe(undefined);
    expect(unwrap(PRODUCTION_DRAWDOWN_DEPS.readJournal({ home }))).toEqual({ events: [SAMPLE], unreadable: 0 });
  });

  it("reads an absent journal as empty", () => {
    expect(unwrap(PRODUCTION_DRAWDOWN_DEPS.readJournal({ home: freshHome() }))).toEqual({
      events: [],
      unreadable: 0,
    });
  });

  it("reports one line when the journal cannot be read", () => {
    const home = freshHome();
    mkdirSync(join(home, "claude-accounts", "drawdown.jsonl"), { recursive: true });
    expect(unwrapErr(PRODUCTION_DRAWDOWN_DEPS.readJournal({ home }))).toEqual([
      "the drawdown journal could not be read: EISDIR: illegal operation on a directory, read",
    ]);
  });

  it("reports one line when the journal cannot be appended to", () => {
    const home = freshHome();
    const parent = join(home, "claude-accounts");
    writeFileSync(parent, "not a directory");
    expect(unwrapErr(PRODUCTION_DRAWDOWN_DEPS.appendJournal({ events: [SAMPLE], home }))).toEqual([
      `the drawdown journal could not be appended to: EEXIST: file already exists, mkdir '${parent}'`,
    ]);
  });
});
