/**
 * `automation due --brief`: the rows a tick decides on kept, the quiet ones counted into one omission line. Pure: a
 * composed report in, the brief report and its lines out.
 */
import { describe, expect, it } from "vitest";

import { composeDueAskReport } from "../../../../../live/automation/dueReport.js";
import { briefDueAskLines, briefDueAskReport, dueAskLines } from "../../../../../live/automation/dueReportLines.js";
import { auditedAgainst, HIS_ANCHOR } from "../../../../auditedOwnerHold.js";
import { claim, NOW_ISO, row, verdict } from "./harness.js";

describe("automation due --brief", () => {
  // One row of every kind the marker column distinguishes, so the filter is pinned against all of them at once.
  const finding = "recipe-failing-broken-2026-10-12t13-00-00.000z-a1";
  const report = composeDueAskReport({
    tickResyncIds: [],
    claims: { "due-claimed": claim() },
    definitions: [
      row({ recipeId: "due-free" }),
      row({ recipeId: "due-claimed" }),
      row({
        hold: { askedIso: "2026-10-12T17:48:38.935Z", clearedBy: null, finding, reason: "held by the store" },
        recipeId: "broken",
      }),
      row({
        hold: { askedIso: "2026-10-17T08:55:40.188Z", clearedBy: null, reason: "chose hold" },
        recipeId: "unowned",
      }),
      row({ kind: "registered-but-unrunnable", recipeId: "no-executor" }),
      row({ recipeId: "current" }),
      row({ enabled: false, recipeId: "disabled" }),
      auditedAgainst({
        definition: row({
          hold: {
            askedIso: "2026-10-19T11:48:00.000Z",
            clearedBy: null,
            placedBy: { anchor: HIS_ANCHOR, words: "pause owner-hold" },
            reason: "the owner's pause",
          },
          recipeId: "owner-hold",
        }),
        record: "please pause owner-hold until Monday",
      }),
    ],
    nowIso: NOW_ISO,
    rejected: ["broken.json · REJECTED · unknown kind"],
    verdicts: [
      verdict({ recipeId: "due-free" }),
      verdict({ recipeId: "due-claimed" }),
      verdict({ due: false, firingsSinceWatermark: 0, offReason: "held", recipeId: "broken" }),
      verdict({ due: false, firingsSinceWatermark: 0, offReason: "held", recipeId: "unowned" }),
      verdict({ due: false, firingsSinceWatermark: 0, recipeId: "no-executor", slotIso: null }),
      verdict({ due: false, firingsSinceWatermark: 0, recipeId: "current", slotIso: null }),
      verdict({ due: false, firingsSinceWatermark: 0, offReason: "disabled", recipeId: "disabled", slotIso: null }),
      verdict({ due: false, firingsSinceWatermark: 0, offReason: "held", recipeId: "owner-hold" }),
    ],
  });

  it("keeps every row a tick decides on — a CLAIMED due row included — and counts the three quiet ones", () => {
    const brief = briefDueAskReport({ report });
    expect(brief.rows.map((one) => one.recipeId).toSorted()).toStrictEqual([
      "broken",
      "due-claimed",
      "due-free",
      "no-executor",
      "unowned",
    ]);
    expect(brief.omittedQuiet).toBe(3);
    expect(brief.rejected).toStrictEqual(["broken.json · REJECTED · unknown kind"]);
  });

  it("replaces the quiet rows with ONE line above the whole report's tally, byte for byte", () => {
    const full = dueAskLines({ report });
    const lines = briefDueAskLines({ report });
    expect(lines.map((line) => line.split(" · ")[0]!.split(" ").slice(0, 2).join(" "))).toStrictEqual([
      "!! broken.json",
      "BROKEN broken",
      "UNOWNED unowned",
      "DUE due-free",
      "-- due-claimed",
      "!! no-executor",
      "automation due",
      "1 actionable",
    ]);
    expect(lines[6]).toBe("automation due · 3 quiet row(s) omitted by --brief — drop --brief to list them");
    expect(lines[lines.length - 1]).toBe(full[full.length - 1]);
    expect(full.length).toBe(lines.length + 2);
  });

  it("keeps a not-due row whose cadence is UNREADABLE, enabled or disabled, since quiet is an allowlist", () => {
    const unreadable = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        row({ cadence: "every so often", recipeId: "vague" }),
        row({ cadence: "every so often", enabled: false, recipeId: "vague-off" }),
        row({ recipeId: "current" }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [
        verdict({ due: false, firingsSinceWatermark: 0, recipeId: "vague", slotIso: null }),
        verdict({ due: false, firingsSinceWatermark: 0, offReason: "disabled", recipeId: "vague-off", slotIso: null }),
        verdict({ due: false, firingsSinceWatermark: 0, recipeId: "current", slotIso: null }),
      ],
    });
    const brief = briefDueAskReport({ report: unreadable });
    expect(brief.rows.map((one) => one.recipeId).toSorted()).toStrictEqual(["vague", "vague-off"]);
    expect(brief.omittedQuiet).toBe(1);
  });

  it("keeps a slot the due judgement DEFERRED to its successor, since a firing happened since the watermark", () => {
    const deferred = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ recipeId: "deferred" }), row({ recipeId: "current" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [
        verdict({
          deferredSlotIso: "2026-09-08T12:00:00.000Z",
          due: false,
          firingsSinceWatermark: 1,
          recipeId: "deferred",
          slotIso: null,
        }),
        verdict({ due: false, firingsSinceWatermark: 0, recipeId: "current", slotIso: null }),
      ],
    });
    const brief = briefDueAskReport({ report: deferred });
    expect(brief.rows.map((one) => one.recipeId)).toStrictEqual(["deferred"]);
    expect(brief.omittedQuiet).toBe(1);
  });

  it("prints no omission line when nothing was quiet, so the brief and full reads are identical", () => {
    const busy = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict()],
    });
    expect(briefDueAskLines({ report: busy })).toStrictEqual(dueAskLines({ report: busy }));
    expect(briefDueAskReport({ report: busy }).omittedQuiet).toBe(0);
  });
});
