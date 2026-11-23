/**
 * The record a Codex fleet read files for the `codex-fleet-capped` monitor — `codex/fleetCapRecord.ts` and the
 * port over its store row. The property that matters most: each capacity row carries the instant it can take a
 * pass again, since that instant is what the note names and when it lapses.
 */
import { describe, expect, it } from "vitest";
import { CodexFleetCapErrors } from "../../../codex/fleetCapErrors.js";
import {
  codexFleetCapReadOf,
  fileCodexFleetCapRecord,
  readCodexFleetCapRecord,
  storeCodexFleetCapPort,
} from "../../../codex/fleetCapPort.js";
import {
  type CodexFleetCapRecord,
  codexFleetCapRecordOf,
  decodeCodexFleetCapRecord,
} from "../../../codex/fleetCapRecord.js";
import {
  decodeCodexFleetCapUnfiled,
  FILING_UNFINISHED,
  unfiledSupersedesRecord,
} from "../../../codex/fleetCapUnfiled.js";
import type { CodexPlanObservation } from "../../../codex/fleetTypes.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import {
  memoryCodexFleetCapPort,
  memoryCodexFleetCapStore,
  unavailableCodexFleetCapPort,
} from "../../codexFleetCapFixture.js";
import { gauge, NOW, nothingEligible, ONE, observation, THREE, TWO } from "./fleetCapRecordFixtures.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.codex;

describe("codexFleetCapRecordOf", () => {
  it("dates a near-cap row by the LATEST of its windows at the bar, and a refusing row by its evidence", () => {
    const record = codexFleetCapRecordOf({
      observations: [
        observation({
          destination: ONE,
          gauge: gauge({
            fiveHour: { resetAtIso: "2026-09-29T03:00:00.000Z", usedPercent: 100 },
            weekly: { resetAtIso: "2026-10-03T17:09:58.000Z", usedPercent: 99 },
          }),
        }),
        observation({
          destination: TWO,
          quota: {
            evidence: {
              kind: "window-limit",
              observedAtIso: NOW,
              resetAtIso: "2026-10-03T17:33:13.000Z",
              windowMinutes: 10_080,
            },
            reason: "exhausted its weekly window",
            refuse: true,
          },
        }),
        observation({ destination: THREE }),
      ],
      ranking: nothingEligible({
        excluded: [
          { destination: ONE, kind: "near-cap", reason: "weekly at 99%" },
          { destination: TWO, kind: "quota-refused", reason: "exhausted its weekly window" },
          { destination: THREE, kind: "signed-out", reason: "nothing is signed in there" },
        ],
      }),
      readAtIso: NOW,
      thresholds: THRESHOLDS,
    });

    expect(record).toEqual({
      readAtIso: NOW,
      rows: [
        {
          alias: "codex-one",
          resetAtIso: "2026-10-03T17:09:58.000Z",
          state: "near-cap",
          week: { resetAtIso: "2026-10-03T17:09:58.000Z", usedPercent: 99 },
        },
        { alias: "codex-two", resetAtIso: "2026-10-03T17:33:13.000Z", state: "quota-refused" },
        { alias: "codex-three", state: "signed-out" },
      ],
    });
  });

  it("carries each row's week and the free resets a signed-in live read counted, soonest expiry first", () => {
    const signedIn: CodexPlanObservation = {
      ...observation({
        destination: ONE,
        gauge: gauge({
          fiveHour: { resetAtIso: "2026-09-29T03:00:00.000Z", usedPercent: 10 },
          weekly: { resetAtIso: "2026-10-03T17:09:58.000Z", usedPercent: 50 },
        }),
      }),
      live: {
        accountId: undefined,
        codexHome: ONE.codexHome,
        email: "one@example.invalid",
        gauges: [],
        kind: "signed-in",
        ordinaryUsageAllowed: undefined,
        planType: "prolite",
        readAtIso: NOW,
        resetCreditsAvailable: 2,
        resetCreditsListed: [
          { expiresAtIso: "2026-11-06T23:55:02.000Z", id: "late", status: "available" },
          { expiresAtIso: "2026-10-29T19:08:08.000Z", id: "soon", status: "available" },
          { expiresAtIso: "2026-10-01T00:00:00.000Z", id: "spent", status: "redeemed" },
        ],
      },
    };
    const record = codexFleetCapRecordOf({
      observations: [signedIn],
      ranking: { basis: "weekly", deferredUnmeasured: [], excluded: [], ranked: [ONE] },
      readAtIso: NOW,
      thresholds: THRESHOLDS,
    });
    expect(record.rows).toEqual([
      {
        alias: "codex-one",
        freeResets: { held: 2, soonestExpiryIso: "2026-10-29T19:08:08.000Z" },
        state: "eligible",
        week: { resetAtIso: "2026-10-03T17:09:58.000Z", usedPercent: 50 },
      },
    ]);
    expect(decodeCodexFleetCapRecord({ value: JSON.parse(JSON.stringify(record)) })).toEqual({ record });
  });

  it("marks a ranked destination eligible, with no reset", () => {
    const record = codexFleetCapRecordOf({
      observations: [observation({ destination: ONE })],
      ranking: { basis: "weekly", deferredUnmeasured: [], excluded: [], ranked: [ONE] },
      readAtIso: NOW,
      thresholds: THRESHOLDS,
    });
    expect(record.rows).toEqual([{ alias: "codex-one", state: "eligible" }]);
  });

  it("leaves a usage-limit refusal undated, because its event names no window", () => {
    const record = codexFleetCapRecordOf({
      observations: [
        observation({
          destination: ONE,
          quota: { evidence: { kind: "usage-limit", observedAtIso: NOW }, reason: "usage limit", refuse: true },
        }),
      ],
      ranking: nothingEligible({ excluded: [{ destination: ONE, kind: "quota-refused", reason: "usage limit" }] }),
      readAtIso: NOW,
      thresholds: THRESHOLDS,
    });
    expect(record.rows).toEqual([{ alias: "codex-one", state: "quota-refused" }]);
  });

  // The owner's own settings are their OWN states: neither may be filed as a capacity state the monitor would
  // read as a provider cap. A usage-limit row is dated by its own weekly reading; a monthly row by nothing at all.
  it("files a usage-limit row with its week's reset and a not-measured row with no reset and no week", () => {
    const reading = gauge({
      fiveHour: { resetAtIso: "2026-09-29T03:00:00.000Z", usedPercent: 10 },
      weekly: { resetAtIso: "2026-10-03T17:09:58.000Z", usedPercent: 30 },
    });
    const record = codexFleetCapRecordOf({
      observations: [
        observation({ destination: ONE, gauge: reading, usageLimitPercent: 30 }),
        observation({ allowance: "monthly-spend", destination: TWO, gauge: reading }),
      ],
      ranking: nothingEligible({
        excluded: [
          { destination: ONE, kind: "usage-limit", reason: "at its 30% usage limit" },
          { destination: TWO, kind: "not-measured", reason: "monthly spend is NOT MEASURED" },
        ],
      }),
      readAtIso: NOW,
      thresholds: THRESHOLDS,
    });

    expect(record.rows).toEqual([
      {
        alias: "codex-one",
        resetAtIso: "2026-10-03T17:09:58.000Z",
        state: "usage-limit",
        week: { resetAtIso: "2026-10-03T17:09:58.000Z", usedPercent: 30 },
      },
      { alias: "codex-two", state: "not-measured" },
    ]);
    expect(decodeCodexFleetCapRecord({ value: JSON.parse(JSON.stringify(record)) })).toEqual({ record });
  });
});

describe("decodeCodexFleetCapRecord", () => {
  it("round-trips a record it wrote", () => {
    const record: CodexFleetCapRecord = {
      readAtIso: NOW,
      rows: [{ alias: "codex-one", resetAtIso: "2026-10-03T17:09:58.000Z", state: "near-cap" }],
    };
    expect(decodeCodexFleetCapRecord({ value: JSON.parse(JSON.stringify(record)) })).toEqual({ record });
  });

  it("round-trips the two owner-setting states exactly, never rewriting either as quota-refused", () => {
    const record: CodexFleetCapRecord = {
      readAtIso: NOW,
      rows: [
        { alias: "codex-one", resetAtIso: "2026-10-03T17:09:58.000Z", state: "usage-limit" },
        { alias: "codex-two", state: "not-measured" },
      ],
    };
    expect(decodeCodexFleetCapRecord({ value: JSON.parse(JSON.stringify(record)) })).toEqual({ record });
  });

  it("refuses an unknown state and names it", () => {
    expect(decodeCodexFleetCapRecord({ value: { readAtIso: NOW, rows: [{ alias: "a", state: "capped" }] } })).toEqual({
      why: 'carries a row with no alias or an unknown state "capped"',
    });
  });

  it("refuses a readAtIso that is not the canonical instant a record is written with", () => {
    expect(decodeCodexFleetCapRecord({ value: { readAtIso: "2026-09-29", rows: [] } })).toEqual({
      why: 'carries readAtIso "2026-09-29", which is not an instant',
    });
  });

  it("refuses a value that is not an object, and rows that are not an array", () => {
    expect(decodeCodexFleetCapRecord({ value: [] })).toEqual({ why: "is not a JSON object" });
    expect(decodeCodexFleetCapRecord({ value: { readAtIso: NOW, rows: {} } })).toEqual({
      why: "carries no rows array",
    });
  });

  it("refuses a row that is not an object, and a row whose reset is not an instant", () => {
    expect(decodeCodexFleetCapRecord({ value: { readAtIso: NOW, rows: ["codex-one"] } })).toEqual({
      why: "carries a row that is not a JSON object",
    });
    expect(
      decodeCodexFleetCapRecord({
        value: { readAtIso: NOW, rows: [{ alias: "codex-one", resetAtIso: 1_759_511_398, state: "near-cap" }] },
      }),
    ).toEqual({ why: "carries codex-one's resetAtIso 1759511398, which is not an instant" });
  });

  it("refuses a week with no used percent and a free-reset count that is not whole", () => {
    expect(
      decodeCodexFleetCapRecord({
        value: { readAtIso: NOW, rows: [{ alias: "codex-one", state: "eligible", week: { resetAtIso: NOW } }] },
      }),
    ).toEqual({ why: "carries codex-one's week with no usedPercent" });
    expect(
      decodeCodexFleetCapRecord({
        value: { readAtIso: NOW, rows: [{ alias: "codex-one", state: "eligible", week: { usedPercent: 140 } }] },
      }),
    ).toEqual({ why: "carries codex-one's week at 140% used, outside 0 to 100" });
    expect(
      decodeCodexFleetCapRecord({
        value: { readAtIso: NOW, rows: [{ alias: "codex-one", freeResets: { held: 1.5 }, state: "eligible" }] },
      }),
    ).toEqual({ why: "carries codex-one's freeResets with no whole held count" });
  });

  it("refuses an offset-bearing week reset or expiry, which a card would print as the wrong UTC minute", () => {
    const decode = ({ row }: { row: Record<string, unknown> }): unknown =>
      decodeCodexFleetCapRecord({
        value: { readAtIso: NOW, rows: [{ alias: "codex-one", state: "eligible", ...row }] },
      });
    expect(decode({ row: { week: { resetAtIso: "2026-10-04T20:45:00+11:00", usedPercent: 50 } } })).toEqual({
      why: 'carries codex-one\'s week reset "2026-10-04T20:45:00+11:00", which is not an instant',
    });
    expect(decode({ row: { freeResets: { held: 1, soonestExpiryIso: "2026-10-09T19:08:08Z" } } })).toEqual({
      why: 'carries codex-one\'s free-reset expiry "2026-10-09T19:08:08Z", which is not an instant',
    });
  });

  it("refuses an alias the register would refuse, so no card line carries a padded, broken or overlong name", () => {
    const why = ({ alias }: { alias: string }): unknown =>
      decodeCodexFleetCapRecord({ value: { readAtIso: NOW, rows: [{ alias, state: "eligible" }] } });
    expect(why({ alias: " codex-one" })).toEqual({
      why: 'carries a row whose alias " codex-one" is not a register plan alias',
    });
    expect(why({ alias: "codex-one\ninjected" })).toEqual({
      why: 'carries a row whose alias "codex-one\\ninjected" is not a register plan alias',
    });
    expect(why({ alias: "a".repeat(33) })).toEqual({
      why: `carries a row whose alias "${"a".repeat(33)}" is not a register plan alias`,
    });
    expect(why({ alias: "a".repeat(41) })).toEqual({
      why: `carries a row whose alias "${"a".repeat(40)}"… is not a register plan alias`,
    });
  });
});

describe("the fleet-cap record port", () => {
  const HOME = "/state/fleet-cap-home";

  it("reads absent before any read files, then the record a read filed", async () => {
    const port = memoryCodexFleetCapPort();
    expect(await readCodexFleetCapRecord({ home: HOME, port })).toEqual({ kind: "absent" });
    const record: CodexFleetCapRecord = { readAtIso: NOW, rows: [{ alias: "codex-one", state: "eligible" }] };
    expect(unwrap(await port.file({ home: HOME, record }))).toBe("filed");
    expect(await readCodexFleetCapRecord({ home: HOME, port })).toEqual({ kind: "record", record });
  });

  it("keeps the newer record when an older read files after it, and says so", async () => {
    const port = memoryCodexFleetCapPort();
    const newer: CodexFleetCapRecord = { readAtIso: "2026-09-29T00:00:05.000Z", rows: [] };
    await fileCodexFleetCapRecord({ home: HOME, port, record: newer });
    const older: CodexFleetCapRecord = { readAtIso: NOW, rows: [{ alias: "codex-one", state: "near-cap" }] };
    expect(unwrap(await port.file({ home: HOME, record: older }))).toBe("kept-later");
    expect(await readCodexFleetCapRecord({ home: HOME, port })).toEqual({ kind: "record", record: newer });
  });

  it("replaces a record judged at the same instant, so a re-read of one moment lands", async () => {
    const port = memoryCodexFleetCapPort();
    await fileCodexFleetCapRecord({ home: HOME, port, record: { readAtIso: NOW, rows: [] } });
    const again: CodexFleetCapRecord = { readAtIso: NOW, rows: [{ alias: "codex-one", state: "eligible" }] };
    expect(unwrap(await port.file({ home: HOME, record: again }))).toBe("filed");
  });

  it("reads a row that does not decode as malformed, never as absent", async () => {
    const store = memoryCodexFleetCapStore();
    store.rows.set(HOME, { readAtIso: "yesterday", rows: [] });
    expect(await readCodexFleetCapRecord({ home: HOME, port: memoryCodexFleetCapPort({ store }) })).toEqual({
      kind: "malformed",
      why: 'carries readAtIso "yesterday", which is not an instant',
    });
  });

  it("reads a store it cannot reach as unreadable, naming the outage, never as absent", async () => {
    expect(await readCodexFleetCapRecord({ home: HOME, port: unavailableCodexFleetCapPort() })).toEqual({
      kind: "unreadable",
      why:
        "the store could not open the Codex fleet-cap record: " +
        "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
    });
  });

  it("never throws when the store refuses a filing, so the read that made the record is not lost", async () => {
    await expect(
      fileCodexFleetCapRecord({
        home: HOME,
        port: unavailableCodexFleetCapPort(),
        record: { readAtIso: NOW, rows: [] },
      }),
    ).resolves.toBeUndefined();
  });

  it("closes every connection it opens, on a read and on a filing", async () => {
    const store = memoryCodexFleetCapStore();
    const port = memoryCodexFleetCapPort({ store });
    await readCodexFleetCapRecord({ home: HOME, port });
    await fileCodexFleetCapRecord({ home: HOME, port, record: { readAtIso: NOW, rows: [] } });
    expect([store.opened, store.closed]).toEqual([2, 2]);
  });

  it("turns a connection that throws into the typed outage, never a raw rejection", async () => {
    const port = storeCodexFleetCapPort({
      connect: () => Promise.reject(new Error("socket hang up")),
    });
    const refused = unwrapErr(await port.read({ home: HOME }));
    expect([refused.code, refused.message]).toEqual([
      "CODEX_FLEET_CAP_STORE_UNAVAILABLE",
      "the store could not open the Codex fleet-cap record: socket hang up",
    ]);
  });
});

describe("codexFleetCapReadOf", () => {
  it("maps a malformed row to malformed with its reason, and an outage to unreadable with its message", () => {
    expect([
      codexFleetCapReadOf({ result: err(CodexFleetCapErrors.malformed({ why: "rows is not a list" })) }),
      codexFleetCapReadOf({
        result: err(CodexFleetCapErrors.storeUnavailable({ doing: "read", reason: "relation does not exist" })),
      }),
    ]).toEqual([
      { kind: "malformed", why: "rows is not a list" },
      {
        kind: "unreadable",
        why: "the store could not read the Codex fleet-cap record: relation does not exist",
      },
    ]);
  });

  it("maps nothing filed to absent and a record to record", () => {
    const record: CodexFleetCapRecord = { readAtIso: NOW, rows: [] };
    expect([
      codexFleetCapReadOf({ result: ok(undefined) }),
      codexFleetCapReadOf({ result: ok({ record, unfiled: undefined }) }),
    ]).toEqual([{ kind: "absent" }, { kind: "record", record }]);
  });

  it("maps a marker strictly later than the record to unfiled, and one at or before it to the record", () => {
    const record: CodexFleetCapRecord = { readAtIso: NOW, rows: [] };
    expect(
      ["2026-09-29T00:00:00.001Z", NOW, "2026-09-28T23:59:59.999Z"].map((attemptedAtIso) =>
        codexFleetCapReadOf({ result: ok({ record, unfiled: { attemptedAtIso, why: "a refusal" } }) }),
      ),
    ).toEqual([
      { attemptedAtIso: "2026-09-29T00:00:00.001Z", kind: "unfiled", why: "a refusal" },
      { kind: "record", record },
      { kind: "record", record },
    ]);
  });
});

describe("decodeCodexFleetCapUnfiled", () => {
  it("decodes a canonical instant with a reason", () => {
    expect(decodeCodexFleetCapUnfiled({ value: { attemptedAtIso: NOW, why: "a refusal" } })).toEqual({
      unfiled: { attemptedAtIso: NOW, why: "a refusal" },
    });
  });

  it("names the field that stops a marker decoding", () => {
    expect([
      decodeCodexFleetCapUnfiled({ value: "x" }),
      decodeCodexFleetCapUnfiled({ value: { attemptedAtIso: "2026-09-29T00:00:00Z", why: "a refusal" } }),
      decodeCodexFleetCapUnfiled({ value: { why: "a refusal" } }),
      decodeCodexFleetCapUnfiled({ value: { attemptedAtIso: NOW, why: "" } }),
    ]).toEqual([
      { why: "is not a JSON object" },
      { why: 'carries attemptedAtIso "2026-09-29T00:00:00Z", which is not an instant' },
      { why: "carries attemptedAtIso undefined, which is not an instant" },
      { why: "carries no reason" },
    ]);
  });
});

describe("unfiledSupersedesRecord", () => {
  it("is true only for a marker strictly later than the record", () => {
    const record: CodexFleetCapRecord = { readAtIso: NOW, rows: [] };
    expect(
      ["2026-09-29T00:00:00.001Z", NOW, "2026-09-28T23:59:59.999Z"].map((attemptedAtIso) =>
        unfiledSupersedesRecord({ record, unfiled: { attemptedAtIso, why: "x" } }),
      ),
    ).toEqual([true, false, false]);
  });
});

describe("a filing that fails", () => {
  const HOME = "/state/fleet-cap-home";
  const T1 = "2026-09-29T00:00:00.000Z";
  const T2 = "2026-09-29T00:05:00.000Z";
  const T3 = "2026-09-29T00:10:00.000Z";
  const REFUSED_WHY = "the store could not file the Codex fleet-cap record: a fixture refusal of the record write";
  const eligibleAt = ({ readAtIso }: { readAtIso: string }): CodexFleetCapRecord => ({
    readAtIso,
    rows: [{ alias: "codex-one", state: "eligible" }],
  });
  const cappedAt = ({ readAtIso }: { readAtIso: string }): CodexFleetCapRecord => ({
    readAtIso,
    rows: [{ alias: "codex-one", state: "quota-refused" }],
  });
  /** A fresh in-memory store whose first filing, an eligible record at T1, has already landed. */
  const seeded = async () => {
    const store = memoryCodexFleetCapStore();
    const port = memoryCodexFleetCapPort({ store });
    await fileCodexFleetCapRecord({ home: HOME, port, record: eligibleAt({ readAtIso: T1 }) });
    return { port, store };
  };

  it("leaves the earlier eligible record read as unfiled, never as that record", async () => {
    const { port, store } = await seeded();
    store.refuseRecordWrites = true;
    await fileCodexFleetCapRecord({ home: HOME, port, record: cappedAt({ readAtIso: T2 }) });
    expect(await readCodexFleetCapRecord({ home: HOME, port })).toEqual({
      attemptedAtIso: T2,
      kind: "unfiled",
      why: REFUSED_WHY,
    });
  });

  it("reads a filing's first marker alone as unfiled, when the store stopped before the refusal was re-marked", async () => {
    const { port, store } = await seeded();
    // The filing's first marker landed and the store stopped answering before anything else did.
    store.unfiled.set(HOME, { attemptedAtIso: T2, why: FILING_UNFINISHED });
    expect(await readCodexFleetCapRecord({ home: HOME, port })).toEqual({
      attemptedAtIso: T2,
      kind: "unfiled",
      why: FILING_UNFINISHED,
    });
  });

  it("is settled by the next record filed after it", async () => {
    const { port, store } = await seeded();
    store.refuseRecordWrites = true;
    await fileCodexFleetCapRecord({ home: HOME, port, record: cappedAt({ readAtIso: T2 }) });
    store.refuseRecordWrites = false;
    await fileCodexFleetCapRecord({ home: HOME, port, record: cappedAt({ readAtIso: T3 }) });
    expect(await readCodexFleetCapRecord({ home: HOME, port })).toEqual({
      kind: "record",
      record: cappedAt({ readAtIso: T3 }),
    });
  });

  it("is not overwritten by a delayed attempt judged earlier", async () => {
    const { port, store } = await seeded();
    store.refuseRecordWrites = true;
    await fileCodexFleetCapRecord({ home: HOME, port, record: cappedAt({ readAtIso: T3 }) });
    await fileCodexFleetCapRecord({ home: HOME, port, record: cappedAt({ readAtIso: T2 }) });
    expect((await readCodexFleetCapRecord({ home: HOME, port })).kind).toBe("unfiled");
    expect(store.unfiled.get(HOME)).toEqual({ attemptedAtIso: T3, why: REFUSED_WHY });
  });

  it("leaves no marker on a successful filing's own record", async () => {
    const { port } = await seeded();
    await fileCodexFleetCapRecord({ home: HOME, port, record: cappedAt({ readAtIso: T2 }) });
    expect(await readCodexFleetCapRecord({ home: HOME, port })).toEqual({
      kind: "record",
      record: cappedAt({ readAtIso: T2 }),
    });
  });

  it("reads a marker that does not decode as malformed, never as the record beside it", async () => {
    const { port, store } = await seeded();
    store.unfiled.set(HOME, { attemptedAtIso: "later", why: "x" });
    expect(await readCodexFleetCapRecord({ home: HOME, port })).toEqual({
      kind: "malformed",
      why: 'filing marker carries attemptedAtIso "later", which is not an instant',
    });
  });
});
