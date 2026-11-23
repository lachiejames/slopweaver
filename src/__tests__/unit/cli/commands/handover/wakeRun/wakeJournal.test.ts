/**
 * `handover wake`'s own wake journal: a dry run never writes one, and a journal that will not read stops every
 * reseat with exit 1, whether or not any park is due yet.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandoverWake } from "../../../../../../cli/commands/handover/wakeRun.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { PAST, record } from "./fixtures.js";
import { fakes, journalPath, mintWakeHome, parkedRow, wakeJson } from "./harness.js";

describe("runHandoverWake", () => {
  let home: string;

  beforeEach(() => {
    ({ home } = mintWakeHome());
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("writes no wake journal on a dry run", async () => {
    parkedRow({ slug: "clock", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    await wakeJson({ deps: fakes({ recorded }), extra: ["--dry-run"], recorded });
    expect(existsSync(journalPath())).toBe(false);
  });

  it("reseats nothing and exits 1 while the wake journal will not read", async () => {
    parkedRow({ slug: "clock", wake: { atIso: PAST, kind: "at" } });
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(journalPath(), '{"kind":"attempt"\n');
    const recorded = record();
    const code = await runHandoverWake({ deps: fakes({ recorded }), rest: ["--home", home] });
    expect([code, recorded.spawned]).toEqual([EXIT_ERROR, []]);
    expect(recorded.diagnostics[0]).toContain("line 1 is not JSON");
  });

  // The journal is read whenever a park carries a wake, so a not-due one does not hide it.
  it("exits 1 on an unreadable wake journal even when no park is due yet", async () => {
    parkedRow({ slug: "later", wake: { atIso: "2026-10-15T04:00:00Z", kind: "at" } });
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(journalPath(), '{"kind":"attempt"\n');
    const recorded = record();
    const code = await runHandoverWake({ deps: fakes({ recorded }), rest: ["--home", home] });
    expect([code, recorded.spawned, recorded.out]).toEqual([EXIT_ERROR, [], []]);
    expect(recorded.diagnostics[0]).toContain("no park reseats until it is repaired");
  });
});
