/**
 * `recordKindAnswerPresses` — each press the note left becomes a mute or a pending hold, and only then is its marker
 * removed. A mute stands even after its card settled; a hold on a card no longer open is moot; every refusal is
 * reported and consumed, so a press this lane never honours cannot hold a note down forever.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type HandStep, MONITOR_WITNESS } from "../../../hand/step.js";
import { MonitorErrors } from "../../../monitor/errors.js";
import { escalationDir, readEscalationHolds } from "../../../monitor/escalationHolds.js";
import { recordKindAnswerPresses } from "../../../monitor/kindAnswerPresses.js";
import { kindMuted, readNoteMutes } from "../../../monitor/noteMutes.js";
import { stateHomePaths } from "../../../stateHome.js";

const PRESSED = "2026-11-05T01:00:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kind-presses-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A monitor card open under `id`. */
function card({ id, witness = MONITOR_WITNESS }: { id: string; witness?: string }): HandStep {
  return { id, postedBy: "monitor", postedIso: PRESSED, unblocks: "u", what: "w", witness };
}

/** Leave the press the note would: `<id>.<answer>` stamped with `stamp`. */
function pressed({ id, answer, stamp = PRESSED }: { id: string; answer: string; stamp?: string }): string {
  const dir = stateHomePaths({ home }).handNoteDismiss;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.${answer}`);
  writeFileSync(path, `${stamp}\n`);
  return path;
}

describe("recordKindAnswerPresses", () => {
  it("records Never for this kind as a mute of the card's monitor, and removes the marker", () => {
    const marker = pressed({ answer: "mute-kind", id: "mon-chair-unpinned" });
    const report = recordKindAnswerPresses({ home, open: [card({ id: "mon-chair-unpinned" })] });
    expect(report).toEqual({
      outcomes: [{ kind: "muted", monitorId: "chair-off-fable", stepId: "mon-chair-unpinned" }],
      problems: [],
    });
    expect(readNoteMutes({ home }).records).toEqual([
      { from: { kind: "note", stepId: "mon-chair-unpinned" }, monitorId: "chair-off-fable", mutedIso: PRESSED },
    ]);
    expect(existsSync(marker)).toBe(false);
  });

  it("keeps a mute pressed on a card that settled since — a mute is about the kind", () => {
    pressed({ answer: "mute-kind", id: "mon-chair-unpinned" });
    const report = recordKindAnswerPresses({ home, open: [] });
    expect(report.outcomes).toEqual([{ kind: "muted", monitorId: "chair-off-fable", stepId: "mon-chair-unpinned" }]);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
  });

  it("refuses a mute on an open step that is no monitor's card, and consumes the press", () => {
    const marker = pressed({ answer: "mute-kind", id: "mon-chair-unpinned" });
    const report = recordKindAnswerPresses({
      home,
      open: [card({ id: "mon-chair-unpinned", witness: "slopweaver hand done mon-chair-unpinned" })],
    });
    const why = "the step is no monitor's card, so it names no kind to mute";
    expect(report).toEqual({
      outcomes: [{ kind: "refused", stepId: "mon-chair-unpinned", why }],
      problems: [MonitorErrors.kindAnswerRefused({ subject: "mon-chair-unpinned", why })],
    });
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses to mute a notice kind", () => {
    pressed({ answer: "mute-kind", id: "mon-repairing-abc" });
    const report = recordKindAnswerPresses({ home, open: [card({ id: "mon-repairing-abc" })] });
    expect(report.outcomes).toEqual([
      {
        kind: "refused",
        stepId: "mon-repairing-abc",
        why: "recipe-repairing is a notice, whose note is its only delivery — it is never muted",
      },
    ]);
    expect(kindMuted({ home, monitorId: "recipe-repairing" })).toBe(false);
  });

  it("refuses a press whose stamp is no instant", () => {
    pressed({ answer: "mute-kind", id: "mon-chair-unpinned", stamp: "" });
    const report = recordKindAnswerPresses({ home, open: [card({ id: "mon-chair-unpinned" })] });
    expect(report.outcomes).toEqual([
      { kind: "refused", stepId: "mon-chair-unpinned", why: "the press carries no instant this lane can read" },
    ]);
  });

  it("records When it gets worse as a pending hold keyed by the occurrence base", () => {
    pressed({ answer: "when-worse", id: "mon-fsev-97860.2" });
    const report = recordKindAnswerPresses({ home, open: [card({ id: "mon-fsev-97860.2" })] });
    expect(report).toEqual({
      outcomes: [{ base: "mon-fsev-97860", kind: "held", stepId: "mon-fsev-97860.2" }],
      problems: [],
    });
    expect(readEscalationHolds({ home }).records).toEqual([
      {
        base: "mon-fsev-97860",
        monitorId: "fseventsd-bloated",
        pressedIso: PRESSED,
        state: { kind: "pending" },
        stepId: "mon-fsev-97860.2",
      },
    ]);
  });

  it("reads a hold pressed on a card no longer open as moot — its subject is gone — and writes nothing", () => {
    pressed({ answer: "when-worse", id: "mon-fsev-97860" });
    const report = recordKindAnswerPresses({ home, open: [] });
    expect(report).toEqual({
      outcomes: [{ kind: "moot", stepId: "mon-fsev-97860", why: "the card is no longer open" }],
      problems: [],
    });
    expect(existsSync(escalationDir({ home }))).toBe(false);
  });

  it("refuses a hold on a monitor that declares no worse", () => {
    pressed({ answer: "when-worse", id: "mon-chair-unpinned" });
    const report = recordKindAnswerPresses({ home, open: [card({ id: "mon-chair-unpinned" })] });
    expect(report.outcomes).toEqual([
      { kind: "refused", stepId: "mon-chair-unpinned", why: "no monitor declares what worse means for this card" },
    ]);
  });

  it("keeps the marker when the store will not write, so the press is retried next pass", () => {
    const marker = pressed({ answer: "mute-kind", id: "mon-chair-unpinned" });
    // A FILE where the store's directory belongs: every write under it fails.
    writeFileSync(join(stateHomePaths({ home }).handSteps, "mutes"), "");
    const report = recordKindAnswerPresses({ home, open: [card({ id: "mon-chair-unpinned" })] });
    expect(report.outcomes).toEqual([]);
    expect(report.problems.map((problem) => problem.code)).toEqual(["KIND_ANSWER_STORE"]);
    expect(existsSync(marker)).toBe(true);
  });

  it("keeps a press whose file will not READ, never refusing the owner's answer away", () => {
    const marker = pressed({ answer: "mute-kind", id: "mon-chair-unpinned" });
    chmodSync(marker, 0o000);
    try {
      const report = recordKindAnswerPresses({ home, open: [card({ id: "mon-chair-unpinned" })] });
      expect(report.outcomes).toEqual([]);
      expect(report.problems.map((problem) => problem.code)).toEqual(["KIND_ANSWER_STORE"]);
      expect(existsSync(marker)).toBe(true);
    } finally {
      chmodSync(marker, 0o600);
    }
  });

  it("keeps a press that is a FIFO, unread, rather than hanging on it", () => {
    const dir = stateHomePaths({ home }).handNoteDismiss;
    mkdirSync(dir, { recursive: true });
    const marker = join(dir, "mon-chair-unpinned.mute-kind");
    execFileSync("mkfifo", [marker]);
    const report = recordKindAnswerPresses({ home, open: [card({ id: "mon-chair-unpinned" })] });
    expect(report.outcomes).toEqual([]);
    expect(report.problems).toEqual([
      MonitorErrors.kindAnswerStore({ cause: "the press would not read: the press is no regular file", path: marker }),
    ]);
    expect(existsSync(marker)).toBe(true);
  });

  it("leaves every other marker in the directory alone", () => {
    pressed({ answer: "done", id: "gcloud-signin" });
    expect(recordKindAnswerPresses({ home, open: [] })).toEqual({ outcomes: [], problems: [] });
    expect(readdirSync(stateHomePaths({ home }).handNoteDismiss)).toEqual(["gcloud-signin.done"]);
  });
});
