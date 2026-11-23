/**
 * The whole DUE-ASKS report as lines: the tally, the order BROKEN, UNOWNED and DUE rows print in, and how a held,
 * disabled or current row reads. Pure: a composed report in, its lines out.
 */
import { describe, expect, it } from "vitest";

import { composeDueAskReport } from "../../../../../live/automation/dueReport.js";
import { dueAskLine, dueAskLines } from "../../../../../live/automation/dueReportLines.js";
import { auditedAgainst, HIS_ANCHOR } from "../../../../auditedOwnerHold.js";
import { claim, NOW_ISO, row, verdict } from "./harness.js";

describe("dueAskLines", () => {
  it("tallies what the tick decides between, not how many rows exist", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: { "atlas-freshness": claim() },
      definitions: [row(), row({ kind: "investigate", recipeId: "self-improvement" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict(), verdict({ recipeId: "self-improvement" })],
    });
    const lines = dueAskLines({ report });
    expect(lines[lines.length - 1]).toBe("1 actionable · 0 want a session · 1 claimed · 2 row(s) read");
  });

  it("says a briefing row is asked here and ANSWERED in the ask lane, never that it is merely run here", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ kind: "investigate", recipeId: "self-improvement" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ recipeId: "self-improvement" })],
    });
    expect(dueAskLine({ row: report.rows[0]! })).toContain("investigate · ask here, ANSWERED in the ask lane");
  });

  it("prints a row held on a failure finding FIRST, marked BROKEN, and counts it in the tally", () => {
    // The defect this pins, MEASURED: resync-corpus-notion, held on its failure finding, printed 34th
    // as `--`, below every DUE row, and the owner saw Notion failing before the chair read it here.
    const finding = "recipe-failing-resync-corpus-notion-2026-10-12t13-00-00.000z-a1";
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        row(),
        row({
          hold: { askedIso: "2026-10-12T17:48:38.935Z", clearedBy: null, finding, reason: "held by the store" },
          recipeId: "resync-corpus-notion",
        }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [
        verdict(),
        verdict({ due: false, firingsSinceWatermark: 0, offReason: "held", recipeId: "resync-corpus-notion" }),
      ],
    });
    const lines = dueAskLines({ report });

    expect(report.rows.map((one) => one.recipeId)).toEqual(["atlas-freshness", "resync-corpus-notion"]);
    expect(lines[0]).toBe(
      "BROKEN resync-corpus-notion · verb-run · run here, in this process · effect read · " +
        `OFF · HELD by the store on finding ${finding} — lifts when that finding settles with its fix, no hatch · covers slot 2026-09-08T12:00:00.000Z`,
    );
    expect(lines[1]!.startsWith("DUE atlas-freshness")).toBe(true);
    expect(lines[2]).toBe(
      "1 actionable · 0 want a session · 0 claimed · 2 row(s) read · 1 BROKEN, held on a failure finding",
    );
  });

  it("prints a held row whose hold nothing attributed as UNOWNED, never as a hold on the owner's approval", () => {
    // A held verdict over a row carrying no hold has no attribution state at all; it never falls
    // through to "lifted only by the owner's recorded approval" without ownerHoldIsOwners being asked.
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "held" })],
    });

    expect(dueAskLines({ report })).toEqual([
      "UNOWNED atlas-freshness · verb-run · run here, in this process · effect read · OFF · HELD, but no word of " +
        "the owner's naming this automation is on the hold — find the owner's word naming it and write " +
        "`hold.placedBy`, or ask on the owner's Queue whether to lift it, no hatch · covers slot 2026-09-08T12:00:00.000Z",
      "0 actionable · 0 want a session · 0 claimed · 1 row(s) read · 1 UNOWNED, owner hold lacks the owner's naming words",
    ]);
  });

  it("keeps an owner hold carrying the owner's naming words as `--`", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        auditedAgainst({
          definition: row({
            hold: {
              askedIso: "2026-10-19T11:48:00.000Z",
              clearedBy: null,
              placedBy: { anchor: HIS_ANCHOR, words: "pause atlas-freshness" },
              reason: "the owner's pause",
            },
          }),
          record: "please pause atlas-freshness until Monday",
        }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "held" })],
    });

    expect(report.rows[0]!.ownerHoldPlacedByState).toEqual({ kind: "anchored" });
    expect(dueAskLines({ report })[0]!.startsWith("-- atlas-freshness")).toBe(true);
  });

  it("prints an owner hold no word of the owner's names as UNOWNED, after BROKEN and before DUE, and tallies it", () => {
    // The defect this pins, MEASURED: vulnfix-topup-acme-admin sat under a hold the chair placed by
    // keypress and the seat wrote up as the owner's, printing `--` among the current rows.
    const finding = "recipe-failing-resync-corpus-notion-2026-10-12t13-00-00.000z-a1";
    const ownerHold = { askedIso: "2026-10-17T08:55:40.188Z", clearedBy: null, reason: "owner chose hold" };
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        row(),
        row({ hold: ownerHold, recipeId: "vulnfix-topup-acme-admin" }),
        auditedAgainst({
          definition: row({
            hold: { ...ownerHold, placedBy: { anchor: HIS_ANCHOR, words: "lead with the discussion" } },
            recipeId: "bumpfix-topup-acme-admin",
          }),
          record: "Always lead with the discussion, never the PR.",
        }),
        row({
          hold: { askedIso: "2026-10-12T17:48:38.935Z", clearedBy: null, finding, reason: "held by the store" },
          recipeId: "resync-corpus-notion",
        }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [
        verdict(),
        verdict({ due: false, firingsSinceWatermark: 0, offReason: "held", recipeId: "vulnfix-topup-acme-admin" }),
        verdict({ due: false, firingsSinceWatermark: 0, offReason: "held", recipeId: "bumpfix-topup-acme-admin" }),
        verdict({ due: false, firingsSinceWatermark: 0, offReason: "held", recipeId: "resync-corpus-notion" }),
      ],
    });
    const lines = dueAskLines({ report });
    const rest = "verb-run · run here, in this process · effect read";

    expect(report.rows.map((one) => one.actionable)).toEqual([true, false, false, false]);
    expect(lines.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual([
      "BROKEN resync-corpus-notion",
      "UNOWNED bumpfix-topup-acme-admin",
      "UNOWNED vulnfix-topup-acme-admin",
      "DUE atlas-freshness",
      "1 actionable",
    ]);
    expect(lines[1]).toBe(
      `UNOWNED bumpfix-topup-acme-admin · ${rest} · OFF · HELD, but no word of the owner's naming this automation ` +
        "is on the hold (the owner's words on the hold name none of this automation's names " +
        "(bumpfix-topup-acme-admin)) — find the owner's word naming it and fix " +
        "`hold.placedBy`, or ask on the owner's Queue whether to lift it, no hatch · covers slot 2026-09-08T12:00:00.000Z",
    );
    expect(lines[2]).toBe(
      `UNOWNED vulnfix-topup-acme-admin · ${rest} · OFF · HELD, but no word of the owner's naming this automation ` +
        "is on the hold — find the owner's word naming it and write `hold.placedBy`, or ask on the owner's Queue " +
        "whether to lift it, no hatch · covers slot 2026-09-08T12:00:00.000Z",
    );
    expect(lines[4]).toBe(
      "1 actionable · 0 want a session · 0 claimed · 4 row(s) read · 1 BROKEN, held on a failure finding · " +
        "2 UNOWNED, owner hold lacks the owner's naming words",
    );
  });

  it("never says only the owner's approval lifts a hold whose anchored state was minted for another row", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        auditedAgainst({
          definition: row({
            hold: {
              askedIso: "2026-10-19T11:48:00.000Z",
              clearedBy: null,
              placedBy: { anchor: HIS_ANCHOR, words: "pause atlas-freshness" },
              reason: "the owner's pause",
            },
          }),
          record: "please pause atlas-freshness until Monday",
        }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "held" })],
    });
    const line = dueAskLine({ row: { ...report.rows[0]!, recipeId: "row-b" } });

    expect(line.startsWith("UNOWNED row-b")).toBe(true);
    expect(line).toContain("OFF · HELD, but the hold's anchored state was not minted for this automation");
    expect(line).not.toContain("lifted only by the owner's recorded approval");
  });

  it("reads an owner hold the view did not audit as UNOWNED, never as the owner's", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        row({
          hold: {
            askedIso: "2026-10-17T08:55:40.188Z",
            clearedBy: null,
            placedBy: { anchor: "talk:t1", words: "pause atlas-freshness" },
            reason: "held",
          },
        }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "held" })],
    });

    expect(report.rows[0]!.ownerHoldPlacedByState).toEqual({
      kind: "unresolved",
      reason: "this view did not read the hold's anchor",
    });
    expect(dueAskLines({ report })[0]!.startsWith("UNOWNED atlas-freshness")).toBe(true);
  });

  it("says so out loud when the install has nothing scheduled at all", () => {
    const report = composeDueAskReport({
      claims: {},
      definitions: [],
      nowIso: NOW_ISO,
      rejected: [],
      tickResyncIds: [],
      verdicts: [],
    });
    expect(dueAskLines({ report })[0]).toBe("automation due · no definitions — nothing is scheduled on this install");
  });

  it("prints a current row too, so a quiet tick is not mistaken for an empty read", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0 })],
    });
    expect(dueAskLine({ row: report.rows[0]! })).toContain("-- atlas-freshness");
    expect(dueAskLine({ row: report.rows[0]! })).toContain("current · next in");
  });

  it("says a HELD row is OFF rather than telling a reader when it next fires", () => {
    // The defect this pins: a row that is off and a row between firings are both `due: false`, so before the
    // report carried `offReason` both printed `current · next in 17.0h` — and someone checking that the
    // digests had been switched off was answered with when they would next post.
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "held" })],
    });
    // The row carries no hold, so nothing checked whose hold it is: it prints UNOWNED, never as the owner's.
    const line = dueAskLine({ row: report.rows[0]! });
    expect(report.rows[0]!.offReason).toBe("held");
    expect(report.rows[0]!.heldOnFinding).toBe(undefined);
    expect(report.rows[0]!.ownerHoldPlacedByState).toBe(undefined);
    expect(line.startsWith("UNOWNED ")).toBe(true);
    expect(line).toContain(
      "OFF · HELD, but no word of the owner's naming this automation is on the hold — find the owner's word",
    );
    expect(line).not.toContain("lifted only by the owner's recorded approval");
    expect(line).not.toContain("current · next in");
  });

  it("names a FAILURE hold's finding, and never tells a reader it waits on the owner's approval", () => {
    // The defect this pins, MEASURED: six resync rows under store-placed failure holds printed
    // "lifted only by the owner's recorded approval", read as blocked on the owner, and sat unrepaired.
    const finding = "recipe-failing-resync-corpus-linear-2026-09-29t06-00-00.000z-a1";
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        row({ hold: { askedIso: "2026-09-30T05:51:58.667Z", clearedBy: null, finding, reason: "held by the store" } }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "held" })],
    });
    const line = dueAskLine({ row: report.rows[0]! });
    expect(report.rows[0]!.heldOnFinding).toBe(finding);
    expect(line).toContain(
      `OFF · HELD by the store on finding ${finding} — lifts when that finding settles with its fix, no hatch`,
    );
    expect(line).not.toContain("the owner's recorded approval");
  });

  it("quotes the board's own line for a failure hold, so a DECLINED finding says it waits on the owner's word", () => {
    // A finding settled declined lifts only on the owner's `clearedBy` (`failureHold.ts`); "lifts on the fix" would
    // hide it.
    const finding = "recipe-failing-resync-atlas-xero-2026-09-26t14-00-00.000z-a1";
    const findingLine =
      `its finding ${finding} was settled declined, so no fix is coming — only the owner's word on the row's ` +
      "`hold.clearedBy` lifts it now; ask for it on the Queue";
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        row({
          hold: {
            askedIso: "2026-09-30T05:09:48.291Z",
            clearedBy: null,
            finding,
            findingState: { held: true, line: findingLine, stage: { kind: "queued" } },
            reason: "held by the store",
          },
        }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "held" })],
    });
    expect(report.rows[0]!.heldFindingLine).toBe(findingLine);
    expect(dueAskLine({ row: report.rows[0]! })).toContain(`OFF · HELD by the store — ${findingLine}, no hatch`);
  });

  it("reads an owner hold carrying a stray finding line as UNOWNED, never as the store's", () => {
    // Only a failure hold is given a findingState (`failureHoldStore.ts`), but the type admits one on any hold.
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        row({
          hold: {
            askedIso: "2026-10-17T08:55:00.000Z",
            clearedBy: null,
            findingState: { held: true, line: "stale derived line", stage: { kind: "queued" } },
            reason: "owner chose 'Hold, discussion first'",
          },
        }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "held" })],
    });
    const line = dueAskLine({ row: report.rows[0]! });
    expect(report.rows[0]!.heldFindingLine).toBe("stale derived line");
    expect(line.startsWith("UNOWNED atlas-freshness · ")).toBe(true);
    expect(line).not.toContain("HELD by the store");
  });

  it("leaves heldOnFinding undefined on a live row even when its definition still carries a lifted hold", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [
        row({ hold: { askedIso: "2026-09-30T05:51:58.667Z", clearedBy: null, finding: "f", reason: "held" } }),
      ],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict()],
    });
    expect(report.rows[0]!.heldOnFinding).toBe(undefined);
  });

  it("says a DISABLED row is OFF, and says which kind of off it is", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "disabled" })],
    });
    const line = dueAskLine({ row: report.rows[0]! });
    expect(line).toContain("OFF · disabled");
    expect(line).not.toContain("OFF · HELD");
    expect(line).not.toContain("current · next in");
  });

  it("leaves a live row's offReason undefined, so nothing that is running reads as off", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict()],
    });
    expect(report.rows[0]!.offReason).toBe(undefined);
    expect(dueAskLine({ row: report.rows[0]! })).not.toContain("OFF ·");
  });

  it("never counts a held row actionable, so no tick runs or claims one", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, firingsSinceWatermark: 0, offReason: "held" })],
    });
    expect(report.rows[0]!.actionable).toBe(false);
  });
});
