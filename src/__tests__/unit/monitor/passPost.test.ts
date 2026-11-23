import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendHandRow, readOpenHandSteps } from "../../../hand/store.js";
import { err, unwrap } from "../../../lib/result.js";
import { arrivalActions, type NoteRaiser, type PageOpener } from "../../../monitor/passPost.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import type { MonitorSubject } from "../../../monitor/types.js";

const NOW_ISO = "2026-10-30T12:00:00.000Z";

/** Records every call so a case can say the injected effect was never reached. */
function recordingEffects(): { calls: string[]; openPage: PageOpener; raiseNote: NoteRaiser } {
  const calls: string[] = [];
  return {
    calls,
    openPage: async ({ url }) => {
      calls.push(`open ${url}`);
      return err("not opened in a unit test");
    },
    raiseNote: ({ step }) => {
      calls.push(`raise ${step.id}`);
      return err("not raised in a unit test");
    },
  };
}

function arrivalsOf({
  arrived,
  fire,
  home = join(tmpdir(), "pass-post-never-written"),
  postedIds = [],
}: {
  arrived: readonly MonitorSubject[];
  fire: boolean;
  home?: string;
  postedIds?: readonly string[];
}) {
  const effects = recordingEffects();
  const outcome = arrivalActions({
    arrived,
    consoleBase: "http://127.0.0.1:4173",
    definition: monitorDefinition({ monitorId: "bot-off-the-air" }),
    fire,
    home,
    monitorId: "bot-off-the-air",
    nowIso: NOW_ISO,
    openPage: effects.openPage,
    postedBy: "unit-test",
    postedIds,
    raiseNote: effects.raiseNote,
  });
  return { calls: effects.calls, outcome };
}

describe("arrivalActions", () => {
  it("answers no rows for no arrivals", async () => {
    const { calls, outcome } = arrivalsOf({ arrived: [], fire: true });
    expect(await outcome).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("answers a held subject's row naming why, and reaches no effect even when firing", async () => {
    const held: MonitorSubject = {
      delivery: { kind: "hold", why: "the owner's card for this is already up" },
      id: "a",
      key: "a-1",
      label: "first",
    };
    const { calls, outcome } = arrivalsOf({ arrived: [held], fire: true });
    expect(await outcome).toEqual([
      {
        detail: "the owner's card for this is already up",
        kind: "held",
        monitorId: "bot-off-the-air",
        stepId: "bot-off-the-air",
      },
    ]);
    expect(calls).toEqual([]);
  });

  it("answers a would-post row for an unheld subject when not firing, and writes nothing", async () => {
    const { calls, outcome } = arrivalsOf({ arrived: [{ id: "a", key: "a-1", label: "first" }], fire: false });
    const rows = await outcome;
    expect(rows.map((row) => row.kind)).toEqual(["posted"]);
    expect(rows[0]!.detail).toContain("would post: ");
    expect(calls).toEqual([]);
  });
});

describe("arrivalActions — a racing pass's card", () => {
  let home = "";
  const subject: MonitorSubject = { id: "a", key: "a-1", label: "first" };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "pass-post-race-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a second card, and its note, beside one a racing pass recorded after this pass's read", async () => {
    const racer = await arrivalsOf({ arrived: [subject], fire: true, home }).outcome;
    const late = arrivalsOf({ arrived: [subject], fire: true, home });
    const rows = await late.outcome;
    expect([racer[0]!.kind, rows.map((row) => row.kind), late.calls]).toEqual(["posted", ["refused"], []]);
    expect(rows[0]!.detail).toContain(`another monitor pass recorded ${racer[0]!.stepId} after this pass read`);
  });

  it("refuses a second card beside a racer's card that the owner's Done SETTLED before this append", async () => {
    const racer = await arrivalsOf({ arrived: [subject], fire: true, home }).outcome;
    const id = racer[0]!.stepId;
    const closed = await appendHandRow({
      home,
      nowIso: NOW_ISO,
      row: { bySession: "owner-done", did: "done", id, kind: "settled", settledIso: NOW_ISO },
    });
    expect(unwrap(closed).appended).toBe(true);
    const late = arrivalsOf({ arrived: [subject], fire: true, home });
    const rows = await late.outcome;
    expect([rows.map((row) => row.kind), late.calls]).toEqual([["refused"], []]);
    expect(rows[0]!.detail).toContain(`another monitor pass recorded ${id} after this pass read`);
  });

  it("still posts the next occurrence beside a leftover card the pass's own read saw", async () => {
    const first = await arrivalsOf({ arrived: [subject], fire: true, home }).outcome;
    const again = await arrivalsOf({ arrived: [subject], fire: true, home, postedIds: [first[0]!.stepId] }).outcome;
    expect([again[0]!.kind, again[0]!.stepId]).toEqual(["posted", `${first[0]!.stepId}.2`]);
  });

  it("posts the next occurrence after a card the owner closed that the pass's own read saw", async () => {
    const first = await arrivalsOf({ arrived: [subject], fire: true, home }).outcome;
    const id = first[0]!.stepId;
    const closed = await appendHandRow({
      home,
      nowIso: NOW_ISO,
      row: { bySession: "owner-done", did: "done", id, kind: "settled", settledIso: NOW_ISO },
    });
    expect(unwrap(closed).appended).toBe(true);
    const postedIds = unwrap(readOpenHandSteps({ home })).postedIds;
    const again = await arrivalsOf({ arrived: [subject], fire: true, home, postedIds }).outcome;
    expect([postedIds, again[0]!.kind, again[0]!.stepId]).toEqual([[id], "posted", `${id}.2`]);
  });
});
