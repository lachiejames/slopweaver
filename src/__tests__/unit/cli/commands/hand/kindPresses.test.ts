/**
 * `recordAndReportKindPresses` — the one line each verb writes per press it honoured, and per problem met: a refusal
 * is named once, by its problem, never twice.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordAndReportKindPresses } from "../../../../../cli/commands/hand/kindPresses.js";
import { type HandStep, MONITOR_WITNESS } from "../../../../../hand/step.js";
import { MonitorErrors } from "../../../../../monitor/errors.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const PRESSED = "2026-11-05T01:00:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kind-press-lines-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A card open under `id`. */
function card({ id, witness = MONITOR_WITNESS }: { id: string; witness?: string }): HandStep {
  return { id, postedBy: "monitor", postedIso: PRESSED, unblocks: "u", what: "w", witness };
}

/** Leave the press the note would: `<id>.<answer>`. */
function pressed({ id, answer }: { id: string; answer: string }): void {
  const dir = stateHomePaths({ home }).handNoteDismiss;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.${answer}`), `${PRESSED}\n`);
}

/** Run the report, collecting its lines. */
function report({ open }: { open: readonly HandStep[] }): { lines: readonly string[]; problems: number } {
  const lines: string[] = [];
  const problems = recordAndReportKindPresses({
    home,
    open,
    verb: "hand push",
    writeDiagnostic: (line) => lines.push(line),
  });
  return { lines, problems };
}

describe("recordAndReportKindPresses", () => {
  it("names a mute, with the command that reverses it", () => {
    pressed({ answer: "mute-kind", id: "mon-chair-unpinned" });
    expect(report({ open: [card({ id: "mon-chair-unpinned" })] })).toEqual({
      lines: [
        "hand push: muted chair-off-fable's note (pressed on mon-chair-unpinned) — its cards still post; `slopweaver hand mute remove chair-off-fable` reverses it",
      ],
      problems: 0,
    });
  });

  it("names a hold by the subject it waits on", () => {
    pressed({ answer: "when-worse", id: "mon-fsev-97860.2" });
    expect(report({ open: [card({ id: "mon-fsev-97860.2" })] })).toEqual({
      lines: ["hand push: mon-fsev-97860.2's note stays down until mon-fsev-97860 reads worse"],
      problems: 0,
    });
  });

  it("names a hold pressed on a card no longer open as moot", () => {
    pressed({ answer: "when-worse", id: "mon-fsev-97860" });
    expect(report({ open: [] })).toEqual({
      lines: ['hand push: "When it gets worse" on mon-fsev-97860 came to nothing: the card is no longer open'],
      problems: 0,
    });
  });

  it("names a refusal once, by its problem, and counts it", () => {
    pressed({ answer: "when-worse", id: "mon-chair-unpinned" });
    const why = "no monitor declares what worse means for this card";
    expect(report({ open: [card({ id: "mon-chair-unpinned" })] })).toEqual({
      lines: [`hand push: ${MonitorErrors.kindAnswerRefused({ subject: "mon-chair-unpinned", why }).message}`],
      problems: 1,
    });
  });
});
