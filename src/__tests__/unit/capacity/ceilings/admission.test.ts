/*
 * The admission a ceilings reading allows: free on the selected route's limiting ceiling, held, unreadable or
 * capped, and a captured reading re-judged from its own ceilings rather than trusted. A spent plan beside an
 * unread one never reads as capped.
 */
import { describe, expect, it } from "vitest";

import { admissionOf, rejudgedReading } from "../../../../capacity/admission.js";
import {
  buildCeilingsReading,
  type Ceiling,
  type CeilingRoute,
  type CeilingsReading,
} from "../../../../capacity/ceilings.js";
import { claude, codex, machine, NOW, plans } from "../ceilingsFixtures.js";

describe("admissionOf", () => {
  it("is free on the selected route's limiting ceiling", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({ claude: [claude({ alias: "plan-one", fiveHour: 0.2, sevenDay: 0.8 })] }),
    });

    expect(admissionOf({ reading })).toStrictEqual({ binding: "claude:plan-one", kind: "free" });
  });

  it("is held when the machine holds", () => {
    const reading = buildCeilingsReading({
      machine: machine({ hold: true, holdSubjects: ["cpu"], load1: 30 }),
      observedAtIso: NOW,
      plans: plans(),
    });

    expect(admissionOf({ reading })).toStrictEqual({ kind: "held" });
  });

  it("is unreadable when the machine carried no load", () => {
    const reading = buildCeilingsReading({ machine: machine({ load1: null }), observedAtIso: NOW, plans: plans() });

    expect(admissionOf({ reading })).toStrictEqual({ kind: "unreadable" });
  });

  it("falls back to the machine alone when no plan could be read", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({ claude: [{ account: "UNREAD", alias: "plan-one", kind: "unreadable", problem: "probe failed" }] }),
    });

    expect(admissionOf({ reading })).toStrictEqual({ binding: "machine", kind: "free" });
  });

  it("is capped when every measured plan is spent", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({ claude: [claude({ alias: "plan-five", fiveHour: 0.1, sevenDay: 1, status: "rejected" })] }),
    });

    expect(admissionOf({ reading })).toStrictEqual({ binding: "claude:plan-five", kind: "capped" });
  });

  it("never reads a spent plan beside an unread routed one as capped — the unread plan proves nothing spent", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [claude({ alias: "plan-five", fiveHour: 0.1, sevenDay: 1, status: "rejected" })],
        codex: [
          {
            account: "UNREAD",
            alias: "codex-one",
            exclusion: null,
            freeResets: null,
            usageLimitPercent: 100,
            windows: null,
          },
        ],
        codexRoutedAlias: "codex-one",
      }),
    });

    expect(reading.lowest).toBe("machine");
    expect(admissionOf({ reading })).toStrictEqual({ binding: "machine", kind: "free" });
  });

  it("re-judges a captured selected route and a captured machine rather than trusting them", () => {
    const spentRoute: CeilingRoute = {
      driver: "claude",
      headroom: 0,
      limitingCeilingId: "claude:p",
      planCeilingId: "claude:p",
    };
    const machineOpen: Ceiling = {
      headroom: 0.8,
      id: "machine",
      kind: "machine",
      reason: null,
      status: "open",
      windows: [],
    };
    const plan: Ceiling = {
      headroom: 0,
      id: "claude:p",
      kind: "claude",
      reason: "spent",
      status: "refusing",
      windows: [],
    };
    const captured: CeilingsReading = {
      ceilings: [machineOpen, plan],
      lowest: "claude:p",
      observedAtIso: NOW,
      problems: [],
      routes: [spentRoute],
      selectedRoute: spentRoute,
    };
    const machineFull: Ceiling = { ...machineOpen, headroom: 0 };

    const staleSelected = { ...captured, selectedRoute: { ...spentRoute, headroom: 0.5 } };

    expect(admissionOf({ reading: captured })).toStrictEqual({ binding: "claude:p", kind: "capped" });
    expect(admissionOf({ reading: staleSelected })).toStrictEqual({ binding: "claude:p", kind: "capped" });
    expect(admissionOf({ reading: { ...captured, ceilings: [machineFull, plan] } })).toStrictEqual({ kind: "held" });
  });

  it("names the machine lowest, as the admission binds, when a spent route stands beside an unread plan", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [{ account: "UNREAD", alias: "plan-one", kind: "unreadable", problem: "probe timed out" }],
        codex: [codex({ alias: "codex-one", used: 100 })],
        codexRoutedAlias: "codex-one",
      }),
    });

    expect(reading.routes.map((route) => route.headroom)).toStrictEqual([0]);
    expect(reading.lowest).toBe("machine");
    expect(admissionOf({ reading })).toStrictEqual({ binding: "machine", kind: "free" });
  });

  it("never reads a captured empty route list beside an open plan as spent", () => {
    const machineOpen: Ceiling = {
      headroom: 0.9,
      id: "machine",
      kind: "machine",
      reason: null,
      status: "open",
      windows: [],
    };
    const openPlan: Ceiling = {
      headroom: 0.6,
      id: "claude:p",
      kind: "claude",
      reason: null,
      status: "open",
      windows: [],
    };
    const captured: CeilingsReading = {
      ceilings: [machineOpen, openPlan],
      lowest: null,
      observedAtIso: NOW,
      problems: [],
      routes: [],
      selectedRoute: null,
    };

    expect(admissionOf({ reading: captured })).toStrictEqual({ binding: "machine", kind: "free" });
    expect(rejudgedReading({ reading: captured }).lowest).toBe("machine");
  });

  it("binds every admission the builder's readings allow to their own lowest", () => {
    const machines = [machine(), machine({ hold: true, holdSubjects: ["cpu"] }), machine({ load1: 30 })];
    const planSets = [
      plans(),
      plans({ claude: [claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 0.35 })] }),
      plans({ claude: [claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 1, status: "rejected" })] }),
      plans({
        claude: [{ account: "UNREAD", alias: "plan-one", kind: "unreadable", problem: "probe timed out" }],
        codex: [codex({ alias: "codex-one", used: 100 })],
        codexRoutedAlias: "codex-one",
      }),
      plans({ codex: [codex({ alias: "codex-one", used: 100 })], codexRoutedAlias: "codex-one" }),
      plans({ problems: ["codex: register unreadable"] }),
    ];
    const pairs = machines.flatMap((one) =>
      planSets.map((set) => {
        const reading = buildCeilingsReading({ machine: one, observedAtIso: NOW, plans: set });
        const admission = admissionOf({ reading });
        const binding = admission.kind === "free" || admission.kind === "capped" ? admission.binding : "none";
        const lowest = admission.kind === "free" || admission.kind === "capped" ? reading.lowest : "none";
        return { binding, lowest };
      }),
    );

    expect(pairs.length).toBe(18);
    expect(pairs.filter((pair) => pair.binding !== pair.lowest)).toStrictEqual([]);
  });

  it("rebuilds a captured route, selection and lowest from the ceilings they came with", () => {
    const openPlan: Ceiling = {
      headroom: 0.2,
      id: "claude:p",
      kind: "claude",
      reason: null,
      status: "open",
      windows: [],
    };
    const machineOpen: Ceiling = {
      headroom: 0.8,
      id: "machine",
      kind: "machine",
      reason: null,
      status: "open",
      windows: [],
    };
    const route: CeilingRoute = {
      driver: "claude",
      headroom: 0.2,
      limitingCeilingId: "claude:p",
      planCeilingId: "claude:p",
    };
    const captured: CeilingsReading = {
      ceilings: [machineOpen, openPlan],
      lowest: "machine",
      observedAtIso: NOW,
      problems: [],
      routes: [route],
      selectedRoute: null,
    };
    const settled = rejudgedReading({ reading: captured });

    expect(settled.lowest).toBe("claude:p");
    expect(settled.selectedRoute).toStrictEqual(route);
    expect(admissionOf({ reading: captured })).toStrictEqual({ binding: "claude:p", kind: "free" });
  });

  it("never reads a spent plan beside a provider whose whole list failed as capped", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [claude({ alias: "plan-five", fiveHour: 0.1, sevenDay: 1, status: "rejected" })],
        problems: ["codex: register unreadable"],
      }),
    });

    expect(reading.lowest).toBe("machine");
    expect(admissionOf({ reading })).toStrictEqual({ binding: "machine", kind: "free" });
  });

  it("names the machine lowest when no plan was measured, and nothing when the machine was not either", () => {
    const unread = plans({
      claude: [{ account: "UNREAD", alias: "plan-one", kind: "unreadable", problem: "probe failed" }],
    });

    expect(buildCeilingsReading({ machine: machine(), observedAtIso: NOW, plans: unread }).lowest).toBe("machine");
    expect(buildCeilingsReading({ machine: machine({ load1: null }), observedAtIso: NOW, plans: unread }).lowest).toBe(
      null,
    );
  });
});
