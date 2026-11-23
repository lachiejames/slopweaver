/*
 * A fired pass's after-stages over an empty pass: nothing owed to re-raise, no hold to judge, so the pass comes back
 * with no rows added and no stage fault.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ok } from "#lib/result.js";
import { withFiredStages } from "../../../../../cli/commands/monitor/checkFiredStages.js";
import type { NoteRaiser } from "../../../../../monitor/pass.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("withFiredStages", () => {
  it("adds no row and no fault to an empty pass, raising nothing", () => {
    const home = mkdtempSync(join(tmpdir(), "fired-stages-"));
    homes.push(home);
    const raised: string[] = [];
    const raiser: NoteRaiser = ({ step }) => {
      raised.push(step.id);
      return ok("raised");
    };
    const diagnostics: string[] = [];
    const result = withFiredStages({
      home,
      now: () => "2026-11-05T00:00:00.000Z",
      open: [],
      passed: { actions: [], readings: [] },
      platform: "darwin",
      raiseNote: raiser,
      rawRaiser: raiser,
      stillHeld: () => true,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
    });
    expect(result.stageFaulted).toBe(false);
    expect(result.outcome.actions).toEqual([]);
    expect(result.outcome.readings).toEqual([]);
    expect(raised).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});
