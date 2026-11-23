/**
 * `handover reconcile`'s outcomes half: the register read once (empty, holding workstreams, or refused), projected into the owner's kept
 * outcomes with the source it was read from, and emitted under the field names the sweep gate reads back.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, unwrap } from "#lib/result.js";
import {
  outcomeFields,
  outcomeRegister,
  reconcileOutcomes,
} from "../../../../../cli/commands/handover/reconcileOutcomes.js";
import { reconcile } from "../../../../../handover/reconcile.js";
import { WorkstreamStoreErrors } from "../../../../../workstreams/store/errors.js";
import { fencedWorkstreamStore } from "../../../../../workstreams/store/register.js";
import { SYNTHETIC_STATED } from "../../../../statedCandidatesFixture.js";
import { inMemoryWorkstreamStore } from "../../../../workstreamStoreFake.js";
import { acmeOutcome } from "../../../../workstreamStoreFixtures.js";
import { keptStated } from "../../../supervisor/outcomes/keptStatedFixture.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A throwaway home, whose profile names no bot handle. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-reconcile-outcomes-"));
  homes.push(home);
  return home;
}

const NOW = "2026-11-09T12:00:00.000Z";

/** A reconciliation over an empty board, which places nobody on anything. */
const EMPTY_BOARD = reconcile({ fleet: "observed", ranked: [], worked: [] });

describe("outcomeRegister", () => {
  it("reads an empty register as none, a populated one as its workstreams, and refuses a store that will not answer", async () => {
    const home = freshHome();
    const empty = inMemoryWorkstreamStore({ nowIso: NOW });
    const populated = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await populated.put({ aggregate: acmeOutcome(), expectedRevision: null, home }));
    const outage = WorkstreamStoreErrors.unavailable({ doing: "read the workstreams", reason: "connection refused" });
    const refusing = fencedWorkstreamStore({ fence: () => err(outage), store: populated });

    expect(await outcomeRegister({ home, store: empty })).toEqual({ workstreams: null });
    const held = unwrap(await populated.read({ home })).workstreams;
    expect(held.map((one) => one.id)).toEqual(["acme-onboarding"]);
    expect(await outcomeRegister({ home, store: populated })).toEqual({ workstreams: held });
    expect(await outcomeRegister({ home, store: refusing })).toEqual({
      refused:
        "handover reconcile: the owner's Workstreams register did not read (WORKSTREAM_STORE_UNAVAILABLE: the store could not read the workstreams: connection refused), so neither their priorities nor their outcomes can be judged",
    });
  });
});

describe("reconcileOutcomes", () => {
  it("declares the source absent and carries no outcome while the register is empty", () => {
    const coverage = reconcileOutcomes({
      home: freshHome(),
      ranked: [],
      result: EMPTY_BOARD,
      workstreams: null,
    });

    expect(outcomeFields({ coverage })).toEqual({
      outcomeSource: { kind: "absent" },
      outcomes: [],
      unanchoredOutcomes: [],
      uncoveredOutcomes: [],
    });
  });

  it("counts a kept stated outcome as present, the owner's words and anchor carried through", () => {
    const kept = SYNTHETIC_STATED.find((one) => one.id === "acme-bot-dogfooded")!;
    const coverage = reconcileOutcomes({
      home: freshHome(),
      ranked: [],
      result: EMPTY_BOARD,
      workstreams: keptStated({ ids: [kept.id] }),
    });
    const fields = outcomeFields({ coverage });

    expect([fields.outcomeSource, fields.unanchoredOutcomes, fields.uncoveredOutcomes]).toEqual([
      { count: 1, kind: "present" },
      [],
      [],
    ]);
    expect(fields.outcomes.map((one) => [one.title, one.words, one.anchor, one.rows])).toEqual([
      [kept.name, kept.outcome, kept.evidence[0]!.anchor, 0],
    ]);
  });
});
