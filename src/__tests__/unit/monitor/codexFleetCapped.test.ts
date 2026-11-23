/**
 * `codex-fleet-capped` — `monitor/codexFleetCapped.ts`. When all four Codex accounts sit capped, the owner
 * must not learn it from a seat screen; every case here is about whether the note says so, and says nothing else.
 */
import { describe, expect, it } from "vitest";

import { fileCodexFleetCapRecord, readCodexFleetCapRecord } from "../../../codex/fleetCapPort.js";
import type { CodexFleetCapRecord } from "../../../codex/fleetCapRecord.js";
import { postingRefusal } from "../../../hand/posting.js";
import { WHAT_CAP } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import { evaluateCodexFleetCapped, fleetCapKey, fleetCapKeyLapsesAt } from "../../../monitor/codexFleetCapped.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import { memoryCodexFleetCapPort, memoryCodexFleetCapStore } from "../../codexFleetCapFixture.js";
import { firing } from "./readings.js";

const NOW = "2026-09-29T00:05:00.000Z";

/** The fleet as `codex route` reads it: five accounts at the weekly bar, one refusing undated. */
const CAPPED: CodexFleetCapRecord = {
  readAtIso: "2026-09-29T00:00:00.000Z",
  rows: [
    { alias: "codex-ambient", state: "quota-refused" },
    { alias: "codex-two", resetAtIso: "2026-10-03T17:10:53.000Z", state: "near-cap" },
    { alias: "codex-three", resetAtIso: "2026-10-03T17:24:37.000Z", state: "near-cap" },
    { alias: "codex-four", resetAtIso: "2026-10-03T17:33:13.000Z", state: "quota-refused" },
    { alias: "codex-one", resetAtIso: "2026-10-03T17:09:58.000Z", state: "near-cap" },
  ],
};

describe("evaluateCodexFleetCapped", () => {
  it("fires once for the whole fleet, keyed and named by the FIRST reset rounded up to the minute", () => {
    expect(evaluateCodexFleetCapped({ nowIso: NOW, read: { kind: "record", record: CAPPED } })).toEqual({
      monitorId: "codex-fleet-capped",
      state: "firing",
      subjects: [
        {
          id: "5 of 5 accounts until 2026-10-03T17:10Z",
          key: "until-2026-10-03t1710",
          label:
            "codex-ambient names no reset, codex-two resets 2026-10-03T17:11Z, codex-three resets 2026-10-03T17:25Z, " +
            "codex-four resets 2026-10-03T17:34Z, codex-one resets 2026-10-03T17:10Z",
        },
      ],
    });
  });

  // The falsifiable partner: the same fleet with ONE account able to take a pass is not capped.
  it("reads clear when any account can take a pass", () => {
    const open = { ...CAPPED, rows: [...CAPPED.rows, { alias: "codex-six", state: "eligible" as const }] };
    expect(evaluateCodexFleetCapped({ nowIso: NOW, read: { kind: "record", record: open } })).toEqual({
      monitorId: "codex-fleet-capped",
      state: "clear",
    });
  });

  it("reads clear when nothing is out for capacity — a pause is the owner's, a sign-out has its own card", () => {
    const record: CodexFleetCapRecord = {
      readAtIso: CAPPED.readAtIso,
      rows: [
        { alias: "codex-one", state: "paused" },
        { alias: "codex-two", state: "signed-out" },
      ],
    };
    expect(evaluateCodexFleetCapped({ nowIso: NOW, read: { kind: "record", record } }).state).toBe("clear");
  });

  it("fires on the capacity rows beside a signed-out one, counting only them", () => {
    const record: CodexFleetCapRecord = {
      readAtIso: CAPPED.readAtIso,
      rows: [
        { alias: "codex-one", resetAtIso: "2026-10-03T17:09:58.000Z", state: "near-cap" },
        { alias: "codex-two", state: "signed-out" },
      ],
    };
    const reading = evaluateCodexFleetCapped({ nowIso: NOW, read: { kind: "record", record } });
    expect(reading).toEqual({
      monitorId: "codex-fleet-capped",
      state: "firing",
      subjects: [
        {
          id: "1 of 2 accounts until 2026-10-03T17:10Z",
          key: "until-2026-10-03t1710",
          label: "codex-one resets 2026-10-03T17:10Z, codex-two signed-out",
        },
      ],
    });
  });

  it("keys a cap no row dates as no-reset, which never lapses on a clock", () => {
    const record: CodexFleetCapRecord = {
      readAtIso: CAPPED.readAtIso,
      rows: [{ alias: "codex-ambient", state: "quota-refused" }],
    };
    const reading = evaluateCodexFleetCapped({ nowIso: NOW, read: { kind: "record", record } });
    expect(reading).toEqual({
      monitorId: "codex-fleet-capped",
      state: "firing",
      subjects: [
        { id: "1 of 1 accounts and none names a reset", key: "no-reset", label: "codex-ambient names no reset" },
      ],
    });
    expect(fleetCapKeyLapsesAt({ key: "no-reset" })).toBe(undefined);
  });

  it("will not call the fleet capped past its first reset — the next Codex read decides", () => {
    const reading = evaluateCodexFleetCapped({
      nowIso: "2026-10-03T17:10:00.000Z",
      read: { kind: "record", record: CAPPED },
    });
    expect(reading.state).toBe("unmeasurable");
    expect(reading).toHaveProperty(
      "because",
      "the last Codex fleet read, at 2026-09-29T00:00:00.000Z, predates codex-one's reset at 2026-10-03T17:09:58.000Z — " +
        "the next read by `slopweaver codex route`, `codex status` or any Codex pass decides",
    );
  });

  it("is unmeasurable, never clear, when no read has filed or the row will not decode", () => {
    expect(evaluateCodexFleetCapped({ nowIso: NOW, read: { kind: "absent" } }).state).toBe("unmeasurable");
    expect(evaluateCodexFleetCapped({ nowIso: NOW, read: { kind: "malformed", why: "x" } })).toEqual({
      because: "the Codex fleet record in the store is malformed: x",
      monitorId: "codex-fleet-capped",
      state: "unmeasurable",
    });
  });

  it("is unmeasurable, never clear, when the store cannot be read", () => {
    expect(evaluateCodexFleetCapped({ nowIso: NOW, read: { kind: "unreadable", why: "connect refused" } })).toEqual({
      because: "the Codex fleet record in the store is unreadable: connect refused",
      monitorId: "codex-fleet-capped",
      state: "unmeasurable",
    });
  });

  // The measured counterexample: a t1 read filed one account eligible, the t2 read saw every account capped and
  // failed to file. Judging the t1 record would draw the fleet clear.
  it("is unmeasurable, never clear, when a later read failed to file over an earlier eligible record", async () => {
    const store = memoryCodexFleetCapStore();
    const port = memoryCodexFleetCapPort({ store });
    const home = "/state/fleet-cap-home";
    const eligible: CodexFleetCapRecord = {
      readAtIso: CAPPED.readAtIso,
      rows: [{ alias: "codex-one", state: "eligible" }],
    };
    await fileCodexFleetCapRecord({ home, port, record: eligible });
    store.refuseRecordWrites = true;
    await fileCodexFleetCapRecord({ home, port, record: { ...CAPPED, readAtIso: "2026-09-29T00:04:00.000Z" } });
    expect(evaluateCodexFleetCapped({ nowIso: NOW, read: await readCodexFleetCapRecord({ home, port }) })).toEqual({
      because:
        "the Codex fleet read at 2026-09-29T00:04:00.000Z did not file its record (the store could not file the Codex " +
        "fleet-cap record: a fixture refusal of the record write), so the earlier one filed no longer describes the " +
        "fleet — the next read by `slopweaver codex route`, `codex status` or any Codex pass decides",
      monitorId: "codex-fleet-capped",
      state: "unmeasurable",
    });
  });

  // Its partner: the same two reads with the t2 filing landing fire, so the case above is the failure, not the reads.
  it("fires when the later capped read files over the earlier eligible record", async () => {
    const port = memoryCodexFleetCapPort();
    const home = "/state/fleet-cap-home";
    const eligible: CodexFleetCapRecord = {
      readAtIso: CAPPED.readAtIso,
      rows: [{ alias: "codex-one", state: "eligible" }],
    };
    await fileCodexFleetCapRecord({ home, port, record: eligible });
    await fileCodexFleetCapRecord({ home, port, record: { ...CAPPED, readAtIso: "2026-09-29T00:04:00.000Z" } });
    expect(evaluateCodexFleetCapped({ nowIso: NOW, read: await readCodexFleetCapRecord({ home, port }) }).state).toBe(
      "firing",
    );
  });
});

describe("the fleet-cap key", () => {
  it("rounds UP to the minute, so the card never lapses before the reset it names", () => {
    expect(fleetCapKey({ firstResetAtIso: "2026-10-03T17:09:01.000Z" })).toBe("until-2026-10-03t1710");
    expect(fleetCapKey({ firstResetAtIso: "2026-10-03T17:10:00.000Z" })).toBe("until-2026-10-03t1710");
    expect(fleetCapKeyLapsesAt({ key: "until-2026-10-03t1710" })).toBe("2026-10-03T17:10:00.000Z");
  });

  it("carries across the hour and the day", () => {
    expect(fleetCapKey({ firstResetAtIso: "2026-10-03T23:59:30.000Z" })).toBe("until-2026-10-04t0000");
  });
});

describe("the codex-fleet-capped card", () => {
  const definition = monitorDefinition({ monitorId: "codex-fleet-capped" });
  const subject = firing({
    reading: evaluateCodexFleetCapped({ nowIso: NOW, read: { kind: "record", record: CAPPED } }),
  }).subjects[0]!;

  it("floats a NOTICE naming the accounts and the first reset, on no queue and asking no purchase", () => {
    const step = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition,
        nowIso: NOW,
        postedBy: "workspace:supervisor",
        subject,
      }),
    );
    expect(step.what).toBe(
      "Codex is capped on 5 of 5 accounts until 2026-10-03T17:10Z — Claude fallbacks plan and review meanwhile",
    );
    expect(step.what.length).toBeLessThanOrEqual(WHAT_CAP);
    expect(step.id).toBe("mon-capped-until-2026-10-03t1710");
    expect([step.notice, step.context, step.url, step.decision]).toEqual([true, undefined, undefined, undefined]);
    expect(step.unblocks).toBe(`nothing — ${subject.label}`);
    expect(step.unaddressed).toBe(
      "nothing waits on you — Codex takes a pass again at the first reset named here, and this note goes when it does",
    );
    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("floats, holds while firing and lapses at the reset its key names", () => {
    expect([definition.floats, definition.holdsWhileFiring, definition.perSubject, definition.context]).toEqual([
      true,
      true,
      undefined,
      undefined,
    ]);
    expect(definition.lapsesAt!({ key: "until-2026-10-03t1710" })).toBe("2026-10-03T17:10:00.000Z");
  });
});
