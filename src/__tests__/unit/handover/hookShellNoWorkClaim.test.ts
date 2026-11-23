/**
 * `handover hook` on the pinned chair's Stop: a reply claiming no work over a board of open rows is blocked with
 * the reading it contradicted, a re-entered Stop reads nothing, and a throwing seam stays silent.
 */
import { describe, expect, it } from "vitest";

import type { NoWorkClaimStopSeams } from "../../../cli/commands/handover/hookNoWorkClaim.js";
import { runHookWith } from "../../../cli/commands/handover/hookRun.js";

const ARGV = ["node", "cli", "handover", "hook", "--dir", "/nope/never"];

/** A real board shape, shrunk: 6 open, 1 ready, 3 held only for naming no repo:, 2 waiting on the owner. */
const OPEN_BOARD = {
  held: [
    { id: "land-acme-1", standing: "blocked" },
    { id: "land-acme-2", standing: "blocked" },
    { id: "land-acme-3", standing: "blocked" },
    { id: "ask-acme-4", standing: "waiting-on-owner" },
    { id: "ask-acme-5", standing: "waiting-on-owner" },
  ],
  rankedCount: 6,
  ready: [{ id: "fix-acme-6" }],
  repolessRows: ["land-acme-1", "land-acme-2", "land-acme-3"],
  trunkMovedRows: [],
};

const REPLY = "Where the fleet is: there is nothing to seat. The board has no runnable row.";

/** A Stop payload from the chair carrying {@link REPLY}. */
const stopPayload = ({ active }: { active: boolean }): string =>
  JSON.stringify({
    hook_event_name: "Stop",
    last_assistant_message: REPLY,
    session_id: "chair-session",
    stop_hook_active: active,
  });

/** Seams for the pinned chair over {@link OPEN_BOARD}, recording which ones were read. */
const chairSeams =
  ({ calls }: { calls: string[] }) =>
  (): NoWorkClaimStopSeams => ({
    hatchIsOpen: () => {
      calls.push("hatch");
      return false;
    },
    isPinnedChair: ({ sessionId }) => {
      calls.push("pin");
      return sessionId === "chair-session";
    },
    lastReconciliation: () => {
      calls.push("reading");
      return OPEN_BOARD;
    },
  });

describe("the pinned chair's Stop is refused for a no-work reply over open rows", () => {
  it("blocks with the reading the reply contradicted, and the claim it made", async () => {
    const printed: string[] = [];
    const calls: string[] = [];

    const exit = await runHookWith({
      argv: ARGV,
      noWorkClaimSeams: chairSeams({ calls }),
      readInput: () => Promise.resolve(stopPayload({ active: false })),
      writeLine: (line) => printed.push(line),
    });

    expect(exit).toBe(0);
    expect(printed.length).toBe(1);
    const output = JSON.parse(printed[0]!) as { decision: string; reason: string };
    expect(output.decision).toBe("block");
    expect(output.reason).toContain(
      "your last reply says there is no work while the reconciliation it read holds 6 open: 1 ready, 3 held only " +
        "for naming no repo: (handover set-repo <slug> --repo <dir>), 2 waiting on the owner",
    );
    expect(output.reason).toContain('your last reply: "nothing to seat"');
    expect(output.reason).toContain("SLOPWEAVER_ALLOW_NO_WORK_CLAIM=1");
  });

  it("reads nothing at all on a re-entered Stop, so it blocks at most once", async () => {
    const printed: string[] = [];
    const calls: string[] = [];

    await runHookWith({
      argv: ARGV,
      noWorkClaimSeams: chairSeams({ calls }),
      readInput: () => Promise.resolve(stopPayload({ active: true })),
      writeLine: (line) => printed.push(line),
    });

    expect([printed, calls]).toEqual([[], []]);
  });

  it("stays silent, exit 0, when a seam throws", async () => {
    const printed: string[] = [];
    const throwing = (): NoWorkClaimStopSeams => ({
      hatchIsOpen: () => false,
      isPinnedChair: () => true,
      lastReconciliation: () => {
        throw new Error("readings ledger exploded");
      },
    });

    const exit = await runHookWith({
      argv: ARGV,
      noWorkClaimSeams: throwing,
      readInput: () => Promise.resolve(stopPayload({ active: false })),
      writeLine: (line) => printed.push(line),
    });

    expect([exit, printed]).toEqual([0, []]);
  });
});
