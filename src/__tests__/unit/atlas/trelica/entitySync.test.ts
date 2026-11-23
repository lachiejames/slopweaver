/**
 * The entity half of a publish over an empty generation: a kind read whole, a kind refused, and a run list read
 * whole whose step detail fell short — which must defer the kind, so the manifest never dates a short sync as a
 * complete one.
 */
import { describe, expect, it } from "vitest";

import { trelicaFirstPartyEntities } from "../../../../atlas/trelica/entityProjection.js";
import type { TrelicaEntityRun } from "../../../../atlas/trelica/entityReads.js";
import { trelicaEntityKindFiles } from "../../../../atlas/trelica/entitySync.js";
import { trelicaKindRecord } from "../../../../atlas/trelica/kindRecord.js";
import { emptyTrelicaKindFile } from "../../../../atlas/trelica/model.js";
import { TRELICA_PROVIDER_TEXT_WITHHELD } from "../../../../atlas/trelica/providerText.js";
import type { TrelicaAtlasSnapshot } from "../../../../atlas/trelica/store.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-10-15T00:00:00.000Z";

/** A generation with nothing published. */
const EMPTY: TrelicaAtlasSnapshot = {
  files: trelicaKindRecord({ of: () => null }),
  manifest: null,
  mismatched: [],
  missing: [],
  superseded: [],
  unpublished: [],
};

/** Two runs read whole off the run list, a device read refused, and `unread` runs' step detail unread. */
function entityRun({ unread }: { unread: number }): TrelicaEntityRun {
  return {
    calls: [],
    reads: [
      {
        entities: trelicaFirstPartyEntities({
          at: AT,
          detailOf: (record) => record,
          endpoint: "POST /FlowApi/FlowItem/FilterItems",
          idOf: (record) => record.id,
          kind: "workflow-run",
          records: [{ id: "r1" }, { id: "r2" }],
        }),
        held: true,
        kind: "workflow-run",
        reason: "2 run(s) read",
      },
      { held: false, kind: "device", reason: "the device list answered 403" },
    ],
    steps: { firstFailure: unread === 0 ? null : "HTTP 500", read: 2 - unread, reused: 0, unread },
  };
}

describe("trelicaEntityKindFiles", () => {
  it("defers a run list read whole whose step detail fell short, keeping its rows, beside a refused kind", () => {
    const result = unwrap(trelicaEntityKindFiles({ at: AT, entities: entityRun({ unread: 1 }), snapshot: EMPTY }));

    expect([...result.deferred]).toEqual([
      ["workflow-run", "1 run(s) hold their status and no step-by-step evidence this sync; the first said: HTTP 500"],
      ["device", "the device list answered 403"],
    ]);
    expect(result.counts).toEqual({ "workflow-run": 2 });
    expect(result.files["workflow-run"]!.entities.map((entity) => entity.providerId).toSorted()).toEqual(["r1", "r2"]);
    expect(result.files["workflow-run"]!.coverage.map((cell) => [cell.channel, cell.state])).toEqual([
      ["first-party-api", "deferred"],
    ]);
    expect(result.files.device!.entities).toEqual([]);
    expect(result.observed.map((gap) => [gap.condition, gap.scope])).toEqual([
      ["workflow-run-steps-unread", "workflow-run-steps"],
      ["first-party-row-unread", "entity:device"],
    ]);
    expect(result.rechecks).toEqual([
      { condition: "first-party-row-unread", resolved: true, scope: "entity:workflow-run" },
      { condition: "workflow-run-steps-unread", resolved: false, scope: "workflow-run-steps" },
      { condition: "first-party-row-unread", resolved: false, scope: "entity:device" },
    ]);
  });

  it("re-holds a stored run's provider text when a refused read republishes the last generation", () => {
    // The generation as an older, looser rule left it on disk, so it is built raw rather than through a sync.
    const stored = {
      ...emptyTrelicaKindFile({ kind: "workflow-run", updatedAt: AT }),
      entities: [
        ...trelicaFirstPartyEntities({
          at: AT,
          detailOf: (record) => ({
            parameters: { clientSecret: record.message },
            steps: [{ failureMessage: record.message, inputParameterValues: { token: record.message } }],
          }),
          endpoint: "POST /FlowApi/FlowItem/FilterItems",
          idOf: (record) => record.id,
          kind: "workflow-run",
          records: [{ id: "r1", message: "login failed for hunter2" }],
        }),
      ],
    };
    const refused: TrelicaEntityRun = {
      calls: [],
      reads: [{ held: false, kind: "workflow-run", reason: "the run list answered 500" }],
      steps: { firstFailure: null, read: 0, reused: 0, unread: 0 },
    };
    const result = unwrap(
      trelicaEntityKindFiles({
        at: AT,
        entities: refused,
        snapshot: { ...EMPTY, files: { ...EMPTY.files, "workflow-run": stored } },
      }),
    );

    expect(JSON.stringify(stored)).toContain("hunter2");
    expect(result.files["workflow-run"]!.entities.map((entity) => entity.channels["first-party-api"]!.detail)).toEqual([
      { parameters: null, steps: [{ failureMessage: TRELICA_PROVIDER_TEXT_WITHHELD, inputParameterValues: null }] },
    ]);
  });

  it("syncs a run list whose every run's step detail was read, and resolves the step gap", () => {
    const result = unwrap(trelicaEntityKindFiles({ at: AT, entities: entityRun({ unread: 0 }), snapshot: EMPTY }));

    expect([...result.deferred]).toEqual([["device", "the device list answered 403"]]);
    expect(result.files["workflow-run"]!.coverage.map((cell) => [cell.channel, cell.state])).toEqual([
      ["first-party-api", "synced"],
    ]);
    expect(result.rechecks[1]).toEqual({
      condition: "workflow-run-steps-unread",
      resolved: true,
      scope: "workflow-run-steps",
    });
  });
});
