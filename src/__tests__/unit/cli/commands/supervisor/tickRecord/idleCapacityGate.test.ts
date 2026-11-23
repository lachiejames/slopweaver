/**
 * The idle-capacity gate through the recorder: a free machine and a ready row nobody is on refuses the tick. It
 * also holds the one-shot stdin case, the proof that each document is read once rather than once per gate.
 */
import { describe, expect, it } from "vitest";

import {
  runSupervisorTickRecord,
  type SupervisorTickRecordDeps,
} from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { allUnavailable, type Capture, capture, NOT_READ, RECONCILE } from "./harness.js";

describe("the idle-capacity gate, as the recorder renders it", () => {
  /** A free machine: every source unavailable except capacity, read with no hold at load 3.77. */
  const FREE_CAPACITY = {
    facts: {
      dispatchBackoffSeconds: 0,
      dispatchCovering: 0,
      dispatchOpen: 0,
      dispatchSubject: "",
      hold: false,
      holdSubjects: [],
      load1: 3.77,
      segmentsPct: 15,
      swapfileCount: 5,
      topForeignGb: 5.2,
      topForeignLabel: "mds",
    },
    observedAtIso: "2026-09-10T12:10:00.000Z",
    status: "read",
    witness: { command: "slopweaver machine capacity --json", exitCode: 0 },
  };

  /** A draft over the free machine, carrying these actions and judgements. */
  function draftWith({
    actions = [],
    judgements = [],
  }: {
    actions?: readonly Record<string, unknown>[];
    judgements?: readonly Record<string, unknown>[];
  } = {}): string {
    return JSON.stringify({
      actions,
      handoff: "handoff-9226",
      judgements,
      sources: { ...allUnavailable(), capacity: FREE_CAPACITY },
      startedIso: "2026-09-10T12:00:00.000Z",
      tickId: "tick-226-2",
      workspace: "workspace:61",
    });
  }

  /** The owner-turn reconciliation, plus a ready list of groomed p2 rows of one kind and empty placements. */
  function reconcileWith({ ids, kind = "doc" }: { ids: readonly string[]; kind?: "doc" | "ask" }): string {
    return JSON.stringify({
      ...(JSON.parse(RECONCILE) as Record<string, unknown>),
      aligned: [],
      misaligned: [],
      ready: ids.map((id) => ({ groomed: true, id, kind, priority: "p2", ready: true })),
      unprioritised: [],
    });
  }

  /** A completed spawn of one row, recorded the way the gate reads it. */
  const SPAWN_THE_DOC = {
    actionId: "tick-226-2-a1",
    kind: "spawned",
    outcome: "completed",
    recordedIso: "2026-09-10T12:15:00.000Z",
    subject: { id: "the-doc", kind: "handover", label: "the-doc on workspace:9" },
    witness: { kind: "command", ref: "slopweaver cmux spawn the-doc --model sonnet" },
  };

  /** The same seams as {@link capture}, with ONLY this gate's hatch shut. */
  async function gated({
    draft,
    reconcile,
  }: {
    draft: string;
    reconcile: string;
  }): Promise<Capture & { code: number }> {
    const run = capture({ files: { "d.json": draft, "r.json": reconcile } });
    const deps: SupervisorTickRecordDeps = { ...run.deps, idleHatchOpen: () => false };
    return {
      ...run,
      code: await runSupervisorTickRecord({
        evidence: NOT_READ,
        deps,
        rest: ["--draft", "d.json", "--reconcile", "r.json"],
      }),
    };
  }

  it("refuses, appending nothing, and names every row, the three ways out and its hatch", async () => {
    const run = await gated({ draft: draftWith(), reconcile: reconcileWith({ ids: ["the-doc"] }) });
    const printed = run.diagnostics.join("\n");

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(printed).toContain(
      "this tick read NO hold (1-minute load 3.77) and left 1 groomed ready p0–p2 doc or ask row(s) with no seat, no spawn and no reason",
    );
    expect(run.diagnostics).toContain("  p2 the-doc");
    expect(printed).toContain("SLOPWEAVER_ALLOW_IDLE_CAPACITY=1");
    expect(printed).toContain('subject is {"kind":"handover","id":"<slug>"}');
    expect(printed).toContain("`slopweaver handover pause <slug> --on <who>`");
    expect(printed).toContain("A `role: supervisor` row is NAMED, never spawned.");
    expect(printed).not.toContain("spawned action(s) name a workspace");
  });

  it("refuses a ready landing DISPATCH ask the same way, appending nothing", async () => {
    const run = await gated({
      draft: draftWith(),
      reconcile: reconcileWith({ ids: ["land-slopweaver-1977-4ddf33f"], kind: "ask" }),
    });

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(run.diagnostics).toContain("  p2 land-slopweaver-1977-4ddf33f");
  });

  it("records the tick once the row's spawn names the row", async () => {
    const run = await gated({
      draft: draftWith({ actions: [SPAWN_THE_DOC] }),
      reconcile: reconcileWith({ ids: ["the-doc"] }),
    });

    expect(run.code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
  });

  it("records the tick with its own hatch open", async () => {
    const run = capture({ files: { "d.json": draftWith(), "r.json": reconcileWith({ ids: ["the-doc"] }) } });
    const code = await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps: run.deps,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
  });

  it("tells a tick whose spawns named WORKSPACES how to re-record them", async () => {
    const workspaceSpawn = { ...SPAWN_THE_DOC, subject: { id: "workspace:9", kind: "session", label: "the-doc" } };
    const run = await gated({
      draft: draftWith({ actions: [workspaceSpawn] }),
      reconcile: reconcileWith({ ids: ["the-doc"] }),
    });

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.diagnostics.join("\n")).toContain(
      '1 spawned action(s) name a workspace ({"kind":"session"}) rather than a row, so they answer no row here',
    );
  });

  it("prints the first 25 rows and counts the rest", async () => {
    const ids = Array.from({ length: 30 }, (_, index) => `doc-${String(index + 1)}`);
    const run = await gated({ draft: draftWith(), reconcile: reconcileWith({ ids }) });

    expect(run.diagnostics.filter((line) => line.startsWith("  p2 doc-")).length).toBe(25);
    expect(run.diagnostics).toContain("  p2 doc-25");
    expect(run.diagnostics).not.toContain("  p2 doc-26");
    expect(run.diagnostics.join("\n")).toContain("  … and 5 more — list them with");
  });

  it("prints EVERY refusing gate at once, in gate order, so one re-draft fixes the tick", async () => {
    const heldCapacity = { ...FREE_CAPACITY, facts: { ...FREE_CAPACITY.facts, hold: true, holdSubjects: ["cpu"] } };
    const draft = JSON.stringify({
      ...(JSON.parse(draftWith()) as Record<string, unknown>),
      sources: { ...allUnavailable(), capacity: heldCapacity },
    });
    const run = capture({ files: { "d.json": draft, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = { ...run.deps, hatchOpen: () => false, loadHatchOpen: () => false };
    const code = await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });
    const printed = run.diagnostics.join("\n");

    expect(code).toBe(EXIT_ERROR);
    expect(printed).toContain("the sweep gate could not judge this tick");
    expect(printed).toContain("dispatched nothing into it");
    expect(printed.indexOf("the sweep gate could not judge")).toBeLessThan(printed.indexOf("dispatched nothing"));
  });

  it("still gates a reconciliation read off STDIN — each document is read once, not once per gate", async () => {
    // The recorder used to re-read both documents inside each gate. A consumed stdin yields nothing the
    // second time, the gate took its cannot-read guard, and `--reconcile -` recorded every tick unjudged.
    const reconcile = reconcileWith({ ids: ["the-doc"] });
    let served = false;
    const run = capture({ files: { "d.json": draftWith() } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      idleHatchOpen: () => false,
      readStdin: () => {
        if (served) {
          return "";
        }
        served = true;
        return reconcile;
      },
    };
    const code = await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps,
      rest: ["--draft", "d.json", "--reconcile", "-"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(run.diagnostics).toContain("  p2 the-doc");
  });
});
