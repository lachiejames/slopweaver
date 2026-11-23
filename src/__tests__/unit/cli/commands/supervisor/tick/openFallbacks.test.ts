/**
 * `sayJsonFallbacks` — the one line per fallen-back JSON reading `tick open` prints on BOTH channels, over the real
 * `digestReadings` reading a real `close-done.json` that carries a monitor's FIRING line ahead of its document.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { digestReadings } from "../../../../../../cli/commands/supervisor/tickFiles.js";
import { sayJsonFallbacks } from "../../../../../../cli/commands/supervisor/tickOpenFallbacks.js";
import type { ReadingOutcome } from "../../../../../../supervisor/scratch/tickCapture.js";
import { dir, fake, useWorkdir } from "./harness.js";

useWorkdir();

/** The close-done reading as the capture leaves it, exited 1 — a completed exit for it. */
const CLOSE_DONE: ReadingOutcome = {
  argv: ["session", "close-done", "--json"],
  bytes: 48,
  child: { durationMs: 5, exitCode: 1, kind: "exited" },
  completed: true,
  errFile: "close-done.err",
  exitCode: 1,
  file: "close-done.json",
  name: "close-done",
};

describe("sayJsonFallbacks", () => {
  it("prints the same fallback on stdout, indented and labelled, and on stderr under the verb's name", () => {
    writeFileSync(join(dir, "close-done.json"), 'steer-at-risk  FIRING over 1\n{"counts":{}}\n');
    const run = fake();
    const readings = [CLOSE_DONE];
    const digested = digestReadings({ dir, readings });
    const text = (digested.get("close-done") as { text: string }).text;
    const line =
      `close-done.json is NOT one JSON document, so the digest reads it as text — ${text}. ` +
      "Something wrote to `slopweaver session close-done --json`'s stdout besides its document; " +
      "the tick draft refuses a document of the wrong shape, so this reading stops the tick until it parses.";

    sayJsonFallbacks({ deps: run.deps, digested, readings });

    expect(run.out).toEqual([`  FELL BACK TO TEXT: ${line}`]);
    expect(run.diagnostics).toEqual([`supervisor tick open: ${line}`]);
  });

  it("prints nothing when the reading parsed", () => {
    writeFileSync(join(dir, "close-done.json"), '{"counts":{}}\n');
    const run = fake();
    const readings = [CLOSE_DONE];

    sayJsonFallbacks({ deps: run.deps, digested: digestReadings({ dir, readings }), readings });

    expect({ diagnostics: run.diagnostics, out: run.out }).toEqual({ diagnostics: [], out: [] });
  });
});
