/** The recorder itself: what one `supervisor tick-record` run appends, prints and exits with, every gate open. */
import { describe, expect, it } from "vitest";

import { runSupervisorTickRecord } from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { allUnavailable, capture, DRAFT, NOT_READ, OWNER_TEXT, RECONCILE } from "./harness.js";

describe("runSupervisorTickRecord", () => {
  it("records the tick and reports the owner turns it stored verbatim", async () => {
    const run = capture({ files: { "d.json": DRAFT, "r.json": RECONCILE } });
    const code = await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps: run.deps,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
    expect(run.appended[0]!.ownerTurns.turns[0]!.text).toBe(OWNER_TEXT);
    expect(run.appended[0]!.finalisedIso).toBe("2026-09-10T12:20:00.000Z");
    expect(run.out[0]!).toContain("1 owner turn(s) stored verbatim (read)");
  });

  it("takes the finalisation instant from --now when one is given", async () => {
    const run = capture({ files: { "d.json": DRAFT, "r.json": RECONCILE } });
    await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps: run.deps,
      rest: ["--draft", "d.json", "--reconcile", "r.json", "--now", "2026-09-10T12:30:00.000Z"],
    });

    expect(run.appended[0]!.finalisedIso).toBe("2026-09-10T12:30:00.000Z");
  });

  it("reads the reconciliation off stdin when asked to", async () => {
    const run = capture({ files: { "d.json": DRAFT }, stdin: RECONCILE });
    const code = await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps: run.deps,
      rest: ["--draft", "d.json", "--reconcile", "-"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.appended[0]!.ownerTurns.turns[0]!.text).toBe(OWNER_TEXT);
  });

  it("exits usage on a bad tail and prints the usage line", async () => {
    const run = capture({ files: {} });
    const code = await runSupervisorTickRecord({ evidence: NOT_READ, deps: run.deps, rest: ["--draft", "d.json"] });

    expect(code).toBe(EXIT_USAGE);
    expect(run.diagnostics.some((line) => line.includes("--reconcile"))).toBe(true);
    expect(run.appended.length).toBe(0);
  });

  it("appends nothing when the reconciliation cannot be read as one", async () => {
    const run = capture({ files: { "d.json": DRAFT, "r.json": JSON.stringify({ headline: "no intake here" }) } });
    const code = await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps: run.deps,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(run.diagnostics[0]!).toContain("handover reconcile --json");
  });

  it("appends nothing when the draft leaves a source out", async () => {
    const sources = allUnavailable();
    delete sources["listener"];
    const draft = JSON.stringify({
      handoff: "handoff-9226",
      sources,
      startedIso: "2026-09-10T12:00:00.000Z",
      tickId: "tick-226-2",
      workspace: "workspace:61",
    });
    const run = capture({ files: { "d.json": draft, "r.json": RECONCILE } });
    const code = await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps: run.deps,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(run.diagnostics.some((line) => line.includes("listener"))).toBe(true);
  });

  it("reports the row as JSON when asked", async () => {
    const run = capture({ files: { "d.json": DRAFT, "r.json": RECONCILE } });
    await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps: run.deps,
      rest: ["--draft", "d.json", "--reconcile", "r.json", "--json"],
    });

    expect(JSON.parse(run.out[0]!)).toEqual({
      finalisedIso: "2026-09-10T12:20:00.000Z",
      judgements: 0,
      ledger: "/tmp/ledger/supervisor-ticks.jsonl",
      ownerTurnStatus: "read",
      ownerTurns: 1,
      stillSpoken: [],
      tickId: "tick-226-2",
    });
  });
});
