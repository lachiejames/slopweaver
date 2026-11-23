/**
 * `tick close`'s fleet health gate: a tick that read a tripped verdict and posted nothing is refused, a posted one
 * or a clear one passes, and a verdict nobody could read refuses rather than passing.
 */
import { describe, expect, it } from "vitest";

import { fleetHealthRefusalLines } from "../../../cli/commands/supervisor/fleetHealthRead.js";
import type { NoteStanding } from "../../../hand/note/raise.js";
import type { PassOutcome } from "../../../monitor/pass.js";
import type { MonitorReading } from "../../../monitor/types.js";
import { type EscalationRead, judgeFleetHealthEscalation } from "../../../supervisor/fleetHealthGate.js";

const FIRING: MonitorReading = {
  monitorId: "fleet-unhealthy",
  state: "firing",
  subjects: [{ id: "fleet health", key: "deaths", label: "2 died mid-run: resync-corpus-slack" }],
};

/**
 * One rehearsal pass's outcome as the gate reads it.
 *
 * @param readings what the pass read
 * @param actions what it would have done
 * @returns the read
 */
function passed({
  readings,
  actions = [],
  notes = [],
}: {
  readings: readonly MonitorReading[];
  actions?: PassOutcome["actions"];
  notes?: readonly { stepId: string; standing: NoteStanding }[];
}): EscalationRead {
  return { kind: "read", notes, outcome: { actions, readings } };
}

describe("judgeFleetHealthEscalation", () => {
  it("refuses a tripped verdict whose card the pass would post, naming what is failing and the card", () => {
    const verdict = judgeFleetHealthEscalation({
      read: passed({
        actions: [
          {
            detail: "would post: Check fleet health — syncs are dying mid-run",
            kind: "posted",
            monitorId: "fleet-unhealthy",
            stepId: "mon-health-deaths-0a1b2c",
          },
        ],
        readings: [FIRING],
      }),
    });
    expect(verdict).toEqual({
      kind: "refused",
      label: "2 died mid-run: resync-corpus-slack",
      unposted: ["mon-health-deaths-0a1b2c — would post: Check fleet health — syncs are dying mid-run"],
    });
  });

  it("refuses a tripped verdict the register refused to post", () => {
    const verdict = judgeFleetHealthEscalation({
      read: passed({
        actions: [
          { detail: "the register would not append", kind: "refused", monitorId: "fleet-unhealthy", stepId: "x" },
        ],
        readings: [FIRING],
      }),
    });
    expect(verdict.kind).toBe("refused");
  });

  it("passes a tripped verdict whose card is open with its note up, or taken down by the owner", () => {
    const notes = [
      { standing: "up", stepId: "mon-health-deaths-0a1b2c" },
      { standing: "dismissed", stepId: "mon-health-deaths-0a1b2c.2" },
    ] as const;
    expect(judgeFleetHealthEscalation({ read: passed({ notes, readings: [FIRING] }) })).toEqual({ kind: "clean" });
  });

  it("passes a tripped verdict the pass HELD after the owner's Done, which is the race the sibling row named", () => {
    const verdict = judgeFleetHealthEscalation({
      read: passed({
        actions: [
          {
            detail: "nothing changed since the note at 00:13Z — the same rows are failing",
            kind: "held",
            monitorId: "fleet-unhealthy",
            stepId: "fleet-unhealthy",
          },
        ],
        readings: [FIRING],
      }),
    });
    expect(verdict).toEqual({ kind: "clean" });
  });

  it("refuses a tripped verdict whose card is open but whose note never came up, naming the raise", () => {
    const verdict = judgeFleetHealthEscalation({
      read: passed({ notes: [{ standing: "absent", stepId: "mon-health-deaths-0a1b2c" }], readings: [FIRING] }),
    });
    expect(verdict).toEqual({
      kind: "refused",
      label: "2 died mid-run: resync-corpus-slack",
      unposted: [
        "mon-health-deaths-0a1b2c — its card is open but its note is not on screen and the owner did not take it down; " +
          "`slopweaver hand show mon-health-deaths-0a1b2c` raises it",
      ],
    });
  });

  it("passes a clear verdict even while an old card's note is gone — the gate reads notes only while tripped", () => {
    const verdict = judgeFleetHealthEscalation({
      read: passed({
        notes: [{ standing: "absent", stepId: "mon-health-x" }],
        readings: [{ monitorId: "fleet-unhealthy", state: "clear" }],
      }),
    });
    expect(verdict).toEqual({ kind: "clean" });
  });

  it("passes a clear verdict, settling a card on recovery included", () => {
    const verdict = judgeFleetHealthEscalation({
      read: passed({
        actions: [{ detail: "cleared", kind: "settled", monitorId: "fleet-unhealthy", stepId: "mon-health-x" }],
        readings: [{ monitorId: "fleet-unhealthy", state: "clear" }],
      }),
    });
    expect(verdict).toEqual({ kind: "clean" });
  });

  it("reads an unmeasurable verdict, a missing one, or a pass that never ran as unreadable", () => {
    expect(
      judgeFleetHealthEscalation({
        read: passed({ readings: [{ because: "no ledger", monitorId: "fleet-unhealthy", state: "unmeasurable" }] }),
      }),
    ).toEqual({ kind: "unreadable", why: "no ledger" });
    expect(judgeFleetHealthEscalation({ read: passed({ readings: [] }) })).toEqual({
      kind: "unreadable",
      why: "the pass returned no fleet-unhealthy reading",
    });
    expect(judgeFleetHealthEscalation({ read: { kind: "unreadable", why: "register torn" } })).toEqual({
      kind: "unreadable",
      why: "register torn",
    });
  });
});

describe("fleetHealthRefusalLines", () => {
  it("prints the hatch's four lines, each unposted card, and the command that posts it", () => {
    const lines = fleetHealthRefusalLines({
      verdict: { kind: "refused", label: "2 died mid-run: r1", unposted: ["mon-health-deaths-0a1b2c — would post"] },
    });
    expect(lines[0]).toContain("this tick read a TRIPPED fleet health verdict and its floating note is not up");
    expect(lines.some((line) => line.includes("SLOPWEAVER_ALLOW_UNESCALATED_FLEET_HEALTH=1"))).toBe(true);
    expect(lines).toContain("  mon-health-deaths-0a1b2c — would post");
    expect(lines.at(-1)).toContain("`slopweaver monitor check --only fleet-unhealthy --fire --by-session");
  });

  it("names why an unreadable verdict refused rather than passing", () => {
    const lines = fleetHealthRefusalLines({ verdict: { kind: "unreadable", why: "register torn" } });
    expect(lines[0]).toContain("the fleet health verdict could not be read — register torn");
  });
});
