/** The load-dispatch gate through the recorder: a held machine nobody was sent to investigate refuses the tick. */
import { describe, expect, it } from "vitest";

import {
  runSupervisorTickRecord,
  type SupervisorTickRecordDeps,
} from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { allUnavailable, type Capture, capture, NOT_READ, RECONCILE } from "./harness.js";

describe("the load-dispatch gate, as the recorder renders it", () => {
  /** Every source unavailable except capacity, which reads the way a case needs it to. */
  function draftReading({ capacity }: { capacity: Record<string, unknown> }): string {
    return JSON.stringify({
      actions: [],
      handoff: "handoff-9226",
      judgements: [],
      sources: { ...allUnavailable(), capacity },
      startedIso: "2026-09-10T12:00:00.000Z",
      tickId: "tick-226-2",
      workspace: "workspace:61",
    });
  }

  /** The facts a 291-26-shaped hold carries, with only what a case varies overridden. */
  function heldFacts(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      dispatchBackoffSeconds: 0,
      dispatchCovering: 0,
      dispatchOpen: 0,
      dispatchSubject: "",
      hold: true,
      holdSubjects: ["cpu"],
      load1: 45.9,
      segmentsPct: 15,
      swapfileCount: 5,
      topForeignGb: 5.2,
      topForeignLabel: "mds",
      ...over,
    };
  }

  /** The same seams as {@link capture}, with THIS gate's hatch shut so the refusal actually renders. */
  async function gated({ draft }: { draft: string }): Promise<Capture & { code: number }> {
    const run = capture({ files: { "d.json": draft, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = { ...run.deps, loadHatchOpen: () => false };
    return {
      ...run,
      code: await runSupervisorTickRecord({
        evidence: NOT_READ,
        deps,
        rest: ["--draft", "d.json", "--reconcile", "r.json"],
      }),
    };
  }

  it("refuses an undispatched hold, naming the load, both escapes and its hatch", async () => {
    const capacity = {
      facts: heldFacts(),
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "read",
      witness: { command: "slopweaver machine capacity --json", exitCode: 0 },
    };
    const run = await gated({ draft: draftReading({ capacity }) });
    const printed = run.diagnostics.join("\n");

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(printed).toContain("read a HOLD on cpu at 1-minute load 45.90 and dispatched nothing into it");
    expect(printed).toContain("SLOPWEAVER_ALLOW_UNDISPATCHED_LOAD=1");
    expect(printed).toContain("slopweaver machine watch --once");
    expect(printed).toContain('{"kind":"machine",…}');
    expect(printed).toContain("Only a SEATED investigation clears this");
  });

  it("records the tick once an investigation is SEATED on the hold", async () => {
    const capacity = {
      facts: heldFacts({ dispatchCovering: 1, dispatchOpen: 1, dispatchSubject: "bfs" }),
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "read",
      witness: { command: "slopweaver machine capacity --json", exitCode: 0 },
    };
    const run = await gated({ draft: draftReading({ capacity }) });

    expect(run.code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
  });

  it("still refuses when the open row seated NOBODY — the failed-spawn case review pass r2 found", async () => {
    const capacity = {
      facts: heldFacts({ dispatchCovering: 0, dispatchOpen: 1, dispatchSubject: "bfs" }),
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "read",
      witness: { command: "slopweaver machine capacity --json", exitCode: 0 },
    };
    const run = await gated({ draft: draftReading({ capacity }) });

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(run.diagnostics.join("\n")).toContain("dispatched nothing into it");
  });

  it("names the RE-CAPTURE, not the two escapes that cannot reach it, when the gate could not judge", async () => {
    // Review pass r1 `no-supervisor-wedge`: this arm returns before the gate reads `dispatchCovering` or the
    // judgements, so a reader told to run `machine watch --once` or record a rationale is refused twice more.
    // A tick that took NO capacity reading is the reachable way in — a draft whose facts merely PREDATE the
    // dispatch block never gets here, because the strict tick schema refuses it in `buildRow` first.
    const capacity = {
      diagnostic: "the machine read timed out",
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "unavailable",
      witness: { command: "slopweaver machine capacity --json", exitCode: null },
    };
    const run = await gated({ draft: draftReading({ capacity }) });
    const printed = run.diagnostics.join("\n");

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(printed).toContain("Re-capture `slopweaver machine capacity --json` into this tick's capacity file");
    expect(printed).toContain("SLOPWEAVER_ALLOW_UNDISPATCHED_LOAD=1");
    expect(printed).toContain("Neither `machine watch --once` nor a hold-rationale answers THIS arm");
  });

  it("passes a tick whose machine was never holding", async () => {
    const capacity = {
      facts: heldFacts({ hold: false, holdSubjects: [] }),
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "read",
      witness: { command: "slopweaver machine capacity --json", exitCode: 0 },
    };
    const run = await gated({ draft: draftReading({ capacity }) });

    expect(run.code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
  });
});
