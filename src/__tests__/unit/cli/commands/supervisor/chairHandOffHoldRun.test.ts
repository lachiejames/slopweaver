/** `supervisor hand-off hold|release` over a mkdtemp home: the reason is required, and the journal decides. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import {
  runChairHandOffHold,
  runChairHandOffRelease,
} from "../../../../../cli/commands/supervisor/chairHandOffHoldRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { readChairHandOffHold } from "../../../../../supervisor/chairHandOffHold.js";

describe("supervisor hand-off hold and release", () => {
  let home: string;
  let out: string[];
  let diagnostics: string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hold-run-"));
    out = [];
    diagnostics = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /**
   * The verbs' deps at one instant.
   *
   * @param nowIso the clock's answer
   * @returns the clock and the two captured channels
   */
  function deps({ nowIso }: { nowIso: string }): {
    nowIso: () => string;
    writeOut: (line: string) => void;
    writeDiagnostic: (line: string) => void;
  } {
    return {
      nowIso: () => nowIso,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    };
  }

  it("holds with the owner's reason, and a release lifts it", () => {
    const held = runChairHandOffHold({
      deps: deps({ nowIso: "2026-11-27T11:00:00.000Z" }),
      rest: ["--reason", "mid-demo", "--home", home],
    });

    expect(held).toBe(EXIT_OK);
    expect(out).toStrictEqual([
      "supervisor hand-off hold: automatic chair hand-off is HELD at 2026-11-27T11:00:00.000Z — mid-demo",
    ]);
    expect(unwrap(readChairHandOffHold({ home }))).toStrictEqual({
      reason: "mid-demo",
      sinceIso: "2026-11-27T11:00:00.000Z",
    });

    const released = runChairHandOffRelease({
      deps: deps({ nowIso: "2026-11-27T12:00:00.000Z" }),
      rest: ["--reason", "demo over", "--home", home],
    });

    expect(released).toBe(EXIT_OK);
    expect(out[1]).toBe(
      "supervisor hand-off release: the hold on automatic chair hand-off is released at 2026-11-27T12:00:00.000Z — demo over",
    );
    expect(unwrap(readChairHandOffHold({ home }))).toBeUndefined();
  });

  it("refuses a hold with no --reason and writes nothing", () => {
    const code = runChairHandOffHold({ deps: deps({ nowIso: "2026-11-27T11:00:00.000Z" }), rest: ["--home", home] });

    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe('supervisor hand-off hold: --reason "<why>" is required');
    expect(unwrap(readChairHandOffHold({ home }))).toBeUndefined();
  });

  it("refuses a blank reason as a usage error", () => {
    const code = runChairHandOffRelease({
      deps: deps({ nowIso: "2026-11-27T11:00:00.000Z" }),
      rest: ["--reason", "  ", "--home", home],
    });

    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics).toStrictEqual([
      'supervisor hand-off release: a hold or release carries the owner\'s reason: pass --reason "<why>"',
    ]);
  });
});
