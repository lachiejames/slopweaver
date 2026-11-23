/**
 * `session close-done` parking a seat on a row the owner EXPLICITLY STEERED — the synthetic replay of the tick
 * that `supervisor tick open` read as text.
 *
 * On that tick the sweep parked an idle steered seat, its in-process `steer-at-risk` pass printed
 * `steer-at-risk  FIRING over 1` on close-done's own stdout ahead of the `--json` document, and `tick close` refused
 * the whole tick until the chair hand-copied the JSON. The stopped world here is that shape: a run its seat launched
 * into, the owner's steer on the row, the seat at rest. Everything between is shipped — the real sweep, the real park, and the
 * real `monitor check` pass the park fires — and only the seams that leave the process are fakes: cmux, the session
 * registry, the macOS note launcher and Chrome.
 *
 * **The falsifiable witness** is the diagnostic channel CARRYING the FIRING line: the pass demonstrably ran and
 * reported, so the empty stdout beside it is the channel, not a pass that never fired. The second case is the same
 * world with no steer on the row, where neither channel hears anything.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeDoneWithClient } from "../../../../../cli/commands/session/closeDone.js";
import { readOpenHandSteps } from "../../../../../hand/store.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import { recordingMonitorDeps } from "../../../../monitorDepsFixture.js";
import { fakeClient } from "./closeDoneFakeCmux.js";
import {
  deps,
  NOW,
  outcomesOf,
  registry,
  removeFixtureDirs,
  SPAWNED_AT,
  sessionRecord,
  writeDoc,
} from "./closeDoneHarness.js";
import { AT_REST, parkedFixture, SEAT, SEAT_TREE } from "./closeDoneParkFixture.js";

afterEach(removeFixtureDirs);

/** The owner's steer on the parked row, as `handover rule --explicit-steer` journals it. */
const STEER: RunEvent = {
  anchor: "talk:p9",
  atIso: SPAWNED_AT,
  decidedIso: SPAWNED_AT,
  explicitSteer: { deliverByIso: "2026-09-03T12:00:00.000Z" },
  kind: "ruling",
  ruling: "overriding the previous guidance: land it by noon",
};

/** Sweep the one at-rest seat of {@link parkedFixture}, its monitor seams recording. */
async function sweep({ steered }: { steered: boolean }): Promise<{
  readonly kinds: readonly string[];
  readonly monitor: ReturnType<typeof recordingMonitorDeps>;
  readonly home: string;
}> {
  const { fixture, runsDir } = parkedFixture();
  writeDoc({ handoverDir: fixture.handoverDir, lines: ["status: ready"], slug: "parked-doc" });
  if (steered) {
    appendRunEvent({ event: STEER, runsDir, slug: "parked-doc" });
  }
  const monitor = recordingMonitorDeps({ nowIso: NOW });
  const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
  const swept = await closeDoneWithClient({
    deps: deps({
      client: fake.client,
      fixture,
      monitor: monitor.deps,
      parkSeat: registry({ records: [sessionRecord()] }),
    }),
  });
  return { home: fixture.home, kinds: outcomesOf(swept).map((outcome) => outcome.kind), monitor };
}

describe("closeDoneWithClient — parking a seat on a steered row", () => {
  it("fires the steer-at-risk pass and reports it on stderr, leaving stdout to the JSON document", async () => {
    const { home, kinds, monitor } = await sweep({ steered: true });
    expect(kinds).toEqual(["parked"]);
    expect(monitor.out).toEqual([]);
    expect(monitor.diagnostics[0]).toBe("steer-at-risk  FIRING over 1");
    expect(monitor.diagnostics[1]).toBe("    parked-doc — its seat closed and nobody is working it");
    expect(monitor.launches()).toBe(1);
    expect(unwrap(readOpenHandSteps({ home })).steps.filter((step) => step.id.startsWith("mon-steer-")).length).toBe(1);
  });

  it("runs no pass at all when the row carries no steer", async () => {
    const { kinds, monitor } = await sweep({ steered: false });
    expect(kinds).toEqual(["parked"]);
    expect({ diagnostics: monitor.diagnostics, launches: monitor.launches(), out: monitor.out }).toEqual({
      diagnostics: [],
      launches: 0,
      out: [],
    });
  });
});
