/*
 * The ceilings reading's schema: every status the builder emits parses and rejudges to itself, and a pause off a
 * paused Claude plan, a machine count other than one, a shared id, a wrong-typed account or free reset, or a
 * status contradicting its headroom is refused. A capture from before account and free resets re-reads.
 */
import { describe, expect, it } from "vitest";

import { rejudgedReading } from "../../../../capacity/admission.js";
import { buildCeilingsReading } from "../../../../capacity/ceilings.js";
import { ceilingsReadingSchema } from "../../../../capacity/ceilingsSchema.js";
import { claude, codex, machine, NOW, pause, plans } from "../ceilingsFixtures.js";

describe("admissionOf", () => {
  it("accepts every status the builder emits, and rejudges its own reading to itself", () => {
    const every = plans({
      claude: [
        claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 0.35 }),
        claude({ alias: "plan-two", fiveHour: 0.1, sevenDay: 1, status: "rejected" }),
        claude({ alias: "plan-five", fiveHour: 0.1, sevenDay: 0.3, usageLimitPercent: 30 }),
        { account: "CACHED three@example.test", alias: "plan-three", kind: "paused", pause, reason: "owner paused it" },
        { account: "UNREAD", alias: "plan-four", kind: "unreadable", problem: "probe timed out" },
      ],
      codex: [
        codex({ alias: "codex-one", used: 20 }),
        { ...codex({ alias: "codex-two", used: 20 }), exclusion: { kind: "paused", reason: "paused by owner" } },
        {
          account: "UNREAD",
          alias: "codex-three",
          exclusion: null,
          freeResets: 1,
          usageLimitPercent: 100,
          windows: null,
        },
        {
          ...codex({ alias: "codex-four", usageLimitPercent: 30, used: 30 }),
          exclusion: { kind: "usage-limit", reason: "weekly at its usage limit" },
        },
        {
          ...codex({ alias: "codex-five", used: 0 }),
          exclusion: { kind: "not-measured", reason: "monthly spend" },
        },
      ],
      codexRoutedAlias: "codex-one",
    });
    const readings = [
      machine(),
      machine({ hold: true, holdSubjects: ["cpu"] }),
      machine({ load1: null }),
      machine({ load1: 30 }),
    ].map((one) => buildCeilingsReading({ machine: one, observedAtIso: NOW, plans: every }));

    expect(readings.map((reading) => ceilingsReadingSchema.safeParse(reading).success)).toStrictEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(readings.map((reading) => rejudgedReading({ reading }))).toStrictEqual(readings);
  });

  it("refuses a pause on any ceiling but a paused Claude plan", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({ claude: [claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 0.35 })] }),
    });
    const [first, open] = reading.ceilings;
    const pausedOpen = { ...reading, ceilings: [first!, { ...open!, pause }] };
    const parsed = ceilingsReadingSchema.safeParse(pausedOpen);

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)).toStrictEqual([
      "claude:plan-one: only a paused Claude plan carries a pause",
    ]);
  });

  it("refuses a reading with other than one machine ceiling, or two ceilings sharing an id", () => {
    const reading = buildCeilingsReading({ machine: machine(), observedAtIso: NOW, plans: plans() });
    const heldTwin = { headroom: 0, id: "machine-2", kind: "machine", reason: "x", status: "held", windows: [] };
    const messages = [
      { ...reading, ceilings: [...reading.ceilings, heldTwin] },
      { ...reading, ceilings: [] },
      { ...reading, ceilings: [...reading.ceilings, { ...reading.ceilings[0]!, kind: "claude" }] },
    ].map((one) => ceilingsReadingSchema.safeParse(one).error!.issues.map((issue) => issue.message));

    expect(messages).toStrictEqual([
      ["2 machine ceilings, where exactly one is read"],
      ["0 machine ceilings, where exactly one is read"],
      ["two ceilings share an id"],
    ]);
  });

  it("re-reads a capture recorded before account and free resets existed, and refuses either of the wrong type", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({ codex: [codex({ alias: "codex-one", used: 20 })], codexRoutedAlias: "codex-one" }),
    });
    const older = {
      ...reading,
      ceilings: reading.ceilings.map(({ account: _account, freeResets: _freeResets, ...rest }) => rest),
    };
    const badAccount = { ...reading, ceilings: [reading.ceilings[0]!, { ...reading.ceilings[1]!, account: 7 }] };
    const badResets = { ...reading, ceilings: [reading.ceilings[0]!, { ...reading.ceilings[1]!, freeResets: -1 }] };

    expect(reading.ceilings.map((ceiling) => [ceiling.account, ceiling.freeResets])).toStrictEqual([
      [null, null],
      ["codex-one@example.test", null],
    ]);
    expect(ceilingsReadingSchema.safeParse(older).success).toBe(true);
    expect(ceilingsReadingSchema.safeParse(older).data!.ceilings[1]).toStrictEqual(older.ceilings[1]);
    expect(ceilingsReadingSchema.safeParse(badAccount).error!.issues[0]!.path).toStrictEqual([
      "ceilings",
      1,
      "account",
    ]);
    expect(ceilingsReadingSchema.safeParse(badResets).error!.issues[0]!.path).toStrictEqual([
      "ceilings",
      1,
      "freeResets",
    ]);
  });

  it("refuses a ceiling whose status contradicts its headroom", () => {
    const reading = buildCeilingsReading({ machine: machine(), observedAtIso: NOW, plans: plans() });
    const unreadAtZero = {
      headroom: 0,
      id: "claude:p",
      kind: "claude",
      reason: "x",
      status: "unreadable",
      windows: [],
    };
    const parsed = ceilingsReadingSchema.safeParse({ ...reading, ceilings: [...reading.ceilings, unreadAtZero] });

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)).toStrictEqual([
      "claude:p: status unreadable with headroom 0",
    ]);
  });
});
