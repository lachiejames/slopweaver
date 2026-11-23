/**
 * What a seat-check judgement leaves behind for `bin/slopweaver` to answer the next prompt from. Only an on-plan
 * verdict over a reading bound to a recorded process start earns a marker; every other judgement is made again. A
 * plan with a usage limit earns a BOUNDED marker naming its plan and expiry, or none.
 */
import { describe, expect, it } from "vitest";

import type { SeatReading, SeatVerdict } from "../../../claude/seatAttest.js";
import { type SeatPassCachePolicy, seatPassPath, seatPassWrite } from "../../../claude/seatPass.js";
import { stateHomePaths } from "../../../stateHome.js";

const DIR = "/Users/someone/.slopweaver/live/seat-pass";
const SESSION = "71e77a67-7fb6-4cd8-8b77-df5a0b3cf615";
const PROC_START = "Tue Oct  6 04:17:25 2026";
const ON_PLAN: SeatVerdict = { alias: "plan-three", how: "store", kind: "on-plan" };
const READ: SeatReading = {
  kind: "read",
  plan: { alias: "plan-three", kind: "store" },
  process: { pid: 91903, procStart: PROC_START },
};
const UNLIMITED: SeatPassCachePolicy = { kind: "unlimited" };
const LIMITED: Extract<SeatPassCachePolicy, { kind: "limited-weekly" }> = {
  alias: "plan-three",
  kind: "limited-weekly",
  validFromEpochSeconds: 1793869200,
  validUntilEpochSeconds: 1793872800,
};

describe("seatPassWrite", () => {
  it("writes the pid, the process start and `-` for no usage limit, tab-separated, under the session's own marker", () => {
    expect(
      seatPassWrite({ cache: UNLIMITED, seatPassDir: DIR, reading: READ, sessionId: SESSION, verdict: ON_PLAN }),
    ).toStrictEqual({
      contents: `91903\t${PROC_START}\t-\n`,
      path: `${DIR}/${SESSION}`,
    });
  });

  it("keeps markers in the directory the bash reader reads", () => {
    expect(stateHomePaths({ home: "/Users/someone/.slopweaver" }).live.seatPassDir).toBe(DIR);
  });

  it.each<SeatVerdict>([
    { kind: "metered", why: "an API key outranks every store" },
    { kind: "off-plan", why: "the default login" },
    { kind: "unmeasured", why: "the plan register could not be read" },
  ])("writes nothing for a $kind verdict, so it is judged again next prompt", (verdict) => {
    expect(seatPassWrite({ cache: UNLIMITED, seatPassDir: DIR, reading: READ, sessionId: SESSION, verdict })).toBe(
      undefined,
    );
  });

  it("writes nothing when the registry recorded no process start, since a reused pid could inherit it", () => {
    const reading: SeatReading = { kind: "read", plan: { alias: "plan-three", kind: "store" } };
    expect(seatPassWrite({ cache: UNLIMITED, seatPassDir: DIR, reading, sessionId: SESSION, verdict: ON_PLAN })).toBe(
      undefined,
    );
  });

  it("writes nothing for a reading that is not a read", () => {
    const reading: SeatReading = { kind: "unconfigured" };
    expect(seatPassWrite({ cache: UNLIMITED, seatPassDir: DIR, reading, sessionId: SESSION, verdict: ON_PLAN })).toBe(
      undefined,
    );
  });

  it.each(["../escape", "a/b", "", "id with space", 'quote"d'])(
    "writes nothing for the session id %j, which is not one safe path segment",
    (sessionId) => {
      expect(seatPassWrite({ cache: UNLIMITED, seatPassDir: DIR, reading: READ, sessionId, verdict: ON_PLAN })).toBe(
        undefined,
      );
      expect(seatPassPath({ seatPassDir: DIR, sessionId })).toBeUndefined();
    },
  );

  it.each([
    "has\ttab",
    "has\nnewline",
    'has"quote',
    "has\\backslash",
    "",
    "haséaccent",
    "hasÿbyte",
    "has[bracket]",
    "has\u007fdelete",
  ])("writes nothing for the process start %j, which the reader could not split or match", (procStart) => {
    const reading: SeatReading = { ...READ, process: { pid: 91903, procStart } };
    expect(
      seatPassWrite({ cache: UNLIMITED, seatPassDir: DIR, reading, sessionId: SESSION, verdict: ON_PLAN }),
    ).toBeUndefined();
  });

  it.each([0, -1, 1.5])("writes nothing for the pid %j", (pid) => {
    const reading: SeatReading = { ...READ, process: { pid, procStart: PROC_START } };
    expect(
      seatPassWrite({ cache: UNLIMITED, seatPassDir: DIR, reading, sessionId: SESSION, verdict: ON_PLAN }),
    ).toBeUndefined();
  });
});

describe("seatPassWrite on a plan with a usage limit", () => {
  it("writes the plan, the judged second and the expiry as three more tab-separated fields", () => {
    expect(
      seatPassWrite({ cache: LIMITED, seatPassDir: DIR, reading: READ, sessionId: SESSION, verdict: ON_PLAN }),
    ).toStrictEqual({
      contents: `91903\t${PROC_START}\tplan-three\t1793869200\t1793872800\n`,
      path: `${DIR}/${SESSION}`,
    });
  });

  it("writes nothing for an uncacheable judgement, so a monthly-spend plan is judged every prompt", () => {
    const cache: SeatPassCachePolicy = { kind: "uncacheable" };
    expect(
      seatPassWrite({ cache, seatPassDir: DIR, reading: READ, sessionId: SESSION, verdict: ON_PLAN }),
    ).toBeUndefined();
  });

  it.each(["../plan", "Plan-Three", "plan three", ""])(
    "writes nothing for the plan %j, which the reader could not key a snapshot on",
    (alias) => {
      const cache: SeatPassCachePolicy = { ...LIMITED, alias };
      expect(
        seatPassWrite({ cache, seatPassDir: DIR, reading: READ, sessionId: SESSION, verdict: ON_PLAN }),
      ).toBeUndefined();
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "writes nothing for the expiry %j, which is no whole epoch second the reader can compare",
    (validUntilEpochSeconds) => {
      const cache: SeatPassCachePolicy = { ...LIMITED, validUntilEpochSeconds };
      expect(
        seatPassWrite({ cache, seatPassDir: DIR, reading: READ, sessionId: SESSION, verdict: ON_PLAN }),
      ).toBeUndefined();
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    "writes nothing for the judged second %j, which is no whole epoch second the reader can compare",
    (validFromEpochSeconds) => {
      const cache: SeatPassCachePolicy = { ...LIMITED, validFromEpochSeconds };
      expect(
        seatPassWrite({ cache, seatPassDir: DIR, reading: READ, sessionId: SESSION, verdict: ON_PLAN }),
      ).toBeUndefined();
    },
  );

  it.each([1793872800, 1793872801])(
    "writes nothing when the judged second %j is not before the expiry, an empty window",
    (validFromEpochSeconds) => {
      const cache: SeatPassCachePolicy = { ...LIMITED, validFromEpochSeconds };
      expect(
        seatPassWrite({ cache, seatPassDir: DIR, reading: READ, sessionId: SESSION, verdict: ON_PLAN }),
      ).toBeUndefined();
    },
  );

  it("writes nothing for a refused verdict even with a limited cache", () => {
    const verdict: SeatVerdict = { kind: "off-plan", why: "the default login" };
    expect(seatPassWrite({ cache: LIMITED, seatPassDir: DIR, reading: READ, sessionId: SESSION, verdict })).toBe(
      undefined,
    );
  });
});
