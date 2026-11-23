/** The unpicked-steer gate through the recorder: a steer of the owner's that a pass came and went over refuses the tick. */
import { describe, expect, it } from "vitest";

import {
  runSupervisorTickRecord,
  type SupervisorTickRecordDeps,
} from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { JudgedSteer, UnpickedSteerRead } from "../../../../../../supervisor/unpickedSteerGate.js";
import { type Capture, capture, DRAFT, NOT_READ, RECONCILE } from "./harness.js";

describe("supervisor tick-record — the unpicked-steer gate", () => {
  /**
   * One steer of the owner's on a card that a pass came and went over.
   *
   * @param registeredAtIso when its relay row registered — after the draft started
   * @returns the steer
   */
  function missed({ registeredAtIso }: { registeredAtIso: string }): JudgedSteer {
    return {
      cardKey: "ask:the-card",
      heard: "ship it tonight",
      registeredAtIso,
      relaySlug: "talk-a00000390000",
      turnId: "a0000039-0000-4000-8000-000000000042",
      verdict: { kind: "reverted", passFinalisedIso: "2026-09-10T12:20:00.000Z", reason: "missed-pass" },
    };
  }

  /** The recorder at a fixed `--now` with the steer hatch shut and `steers` as the reading. */
  async function gated({
    steers,
    open = {},
  }: {
    steers: UnpickedSteerRead;
    open?: Partial<SupervisorTickRecordDeps>;
  }): Promise<
    Capture & {
      code: number;
      asked: string[];
    }
  > {
    const run = capture({ files: { "d.json": DRAFT, "r.json": RECONCILE } });
    const asked: string[] = [];
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readUnpickedSteers: ({ nowIso }) => {
        asked.push(nowIso);
        return Promise.resolve(steers);
      },
      approvedDraftHatchOpen: () => true,
      readApprovedDrafts: () => ({
        items: [],
        answers: new Map(),
        kind: "read",
        landings: { bound: [], unreadable: [] },
        skippedLines: 0,
        unreadApproved: [],
        unsureIds: [],
      }),
      steerHatchOpen: () => false,
      ...open,
    };
    const code = await runSupervisorTickRecord({
      deps,
      evidence: NOT_READ,
      rest: ["--draft", "d.json", "--reconcile", "r.json", "--now", "2026-09-10T12:30:00.000Z"],
    });
    return { ...run, asked, code };
  }

  it("refuses a steer registered before the tick started, appending nothing, naming it and its hatch", async () => {
    const run = await gated({
      steers: { kind: "read", steers: [missed({ registeredAtIso: "2026-09-10T11:59:00.000Z" })], undecodedRelays: 0 },
    });
    const printed = run.diagnostics.join("\n");

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(printed).toContain("talk:a0000039-0000-4000-8000-000000000042 on ask:the-card");
    expect(printed).toContain("supervisor intake-mark --turn talk:<turnId>");
    expect(printed).toContain("SLOPWEAVER_ALLOW_UNPICKED_STEERS=1");
  });

  it("reads the steers once, at the machine clock rather than the row's --now, so --now cannot slide the window", async () => {
    const run = await gated({ steers: { kind: "read", steers: [], undecodedRelays: 0 } });

    expect(run.asked).toStrictEqual(["2026-09-10T12:20:00.000Z"]);
  });

  it("records a tick over a steer registered after it started", async () => {
    const run = await gated({
      steers: { kind: "read", steers: [missed({ registeredAtIso: "2026-09-10T12:05:00.000Z" })], undecodedRelays: 0 },
    });

    expect(run.code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
  });

  it("refuses a read that failed rather than recording a tick that saw nothing", async () => {
    const run = await gated({ steers: { kind: "unreadable", why: "talk/relays.jsonl did not read: EACCES" } });

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(run.diagnostics.join("\n")).toContain("talk/relays.jsonl did not read: EACCES");
  });

  it("is released by its own hatch and by no other", async () => {
    const owed: UnpickedSteerRead = {
      kind: "read",
      steers: [missed({ registeredAtIso: "2026-09-10T11:00:00.000Z" })],
      undecodedRelays: 0,
    };
    const others = await gated({
      open: {
        hatchOpen: () => true,
        idleHatchOpen: () => true,
        loadHatchOpen: () => true,
        recipeFailureHatchOpen: () => true,
        voiceHatchOpen: () => true,
      },
      steers: owed,
    });
    const own = await gated({ open: { steerHatchOpen: () => true }, steers: owed });

    expect(others.code).toBe(EXIT_ERROR);
    expect(own.code).toBe(EXIT_OK);
  });
});
