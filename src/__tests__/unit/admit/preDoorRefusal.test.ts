// The line parsers went with door.jsonl.
import { describe, expect, it } from "vitest";

import { preDoorRefusalCoverageLines, preDoorRefusalLines, preDoorRefusalOf } from "../../../admit/doorRefusalRead.js";
import { doorDecisionRecord, type PreDoorRefusal, preDoorRefusalRecord } from "../../../admit/ledger.js";
import type { DoorRequest } from "../../../admit/types.js";
import { type AboveFoldVerdict, aboveFoldRefusalRow, printedAboveFoldRefusals } from "../../../cli/aboveFoldDoor.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { projectDoorLine } from "../../../store/fleet/doorEvent.js";
import { memoryDoorLedger } from "../../doorLedgerFixture.js";

/** The fixture home a refusal names; the in-memory store is what records it. */
const HOME = "/fixture/home";

const refusal: PreDoorRefusal = {
  findings: [
    { code: "voice-rule", message: 'matches the configured literal voice rule "—". Rewrite it.', path: "headline" },
    {
      code: "colon-list",
      message: "a colon introducing a list packs several facts into one sentence.",
      path: "detail",
    },
  ],
  gate: "above-the-fold-voice",
  hatch: "voice-rules",
  runId: "r-1",
  surface: "slack",
  tsIso: "2026-09-19T01:00:00.000Z",
};

/** A verdict with the given refusal lines, in the shape `aboveFoldVerdictFor` returns. */
function verdictWith({ refusals }: { refusals: readonly string[] }): AboveFoldVerdict {
  return {
    findings: refusals.length === 0 ? [] : [{ code: "voice-rule", message: "m", path: "headline" }],
    lengthCalibration: "measured",
    lengthWarnings: [],
    refusals,
    surface: "slack",
    warnings: [],
  };
}

describe("preDoorRefusalRecord", () => {
  it("records the refusal as one exact object carrying the gate, the hatch and every finding", () => {
    expect(preDoorRefusalRecord({ refusal })).toStrictEqual({
      action: "gate:above-the-fold-voice",
      effect: "external-write",
      findings: [
        {
          code: "voice-rule",
          message: 'matches the configured literal voice rule "—". Rewrite it.',
          path: "headline",
        },
        {
          code: "colon-list",
          message: "a colon introducing a list packs several facts into one sentence.",
          path: "detail",
        },
      ],
      gate: "above-the-fold-voice",
      hatch: "voice-rules",
      runId: "r-1",
      schemaVersion: 1,
      status: "refused",
      surface: "slack",
      tsIso: "2026-09-19T01:00:00.000Z",
    });
  });
});

describe("preDoorRefusalOf", () => {
  it("reads back exactly what the writer wrote", () => {
    expect(preDoorRefusalOf({ record: preDoorRefusalRecord({ refusal }) })).toStrictEqual({
      findings: refusal.findings,
      gate: "above-the-fold-voice",
      hatch: "voice-rules",
      runId: "r-1",
      surface: "slack",
      tsIso: "2026-09-19T01:00:00.000Z",
    });
  });

  it("ignores a pass record, a non-object and a refused record missing its fields rather than inventing one", () => {
    const pass: DoorRequest = {
      action: { kind: "verb", noun: "slack", verb: "post" },
      artifact: {},
      meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
    };
    const passRecord = doorDecisionRecord({
      decision: { findings: [], overridden: [], status: "pass" },
      request: pass,
      runId: "r-3",
      tsIso: "2026-09-19T03:00:00.000Z",
    });
    expect(preDoorRefusalOf({ record: passRecord })).toBeUndefined();
    expect(preDoorRefusalOf({ record: null })).toBeUndefined();
    expect(preDoorRefusalOf({ record: "refused" })).toBeUndefined();
    expect(preDoorRefusalOf({ record: { status: "refused" } })).toBeUndefined();
  });
});

describe("the port's pre-door refusal read", () => {
  it("round-trips a refusal through the store, newest last within the limit", async () => {
    const door = memoryDoorLedger();
    for (const runId of ["r-a", "r-b", "r-c"]) {
      unwrap(await door.port.appendPreDoorRefusal({ home: HOME, refusal: { ...refusal, runId } }));
    }
    const read = unwrap(await door.port.readRecentPreDoorRefusals({ home: HOME, limit: 2 }));
    expect(read.map((entry) => entry.runId)).toStrictEqual(["r-b", "r-c"]);
    expect(read[0]!.findings[0]!.code).toBe("voice-rule");
  });

  it("returns an empty list for a store that has recorded no refusal", async () => {
    const read = await memoryDoorLedger().port.readRecentPreDoorRefusals({ home: HOME, limit: 10 });
    expect(unwrap(read)).toStrictEqual([]);
  });

  it("keeps nothing at a limit of zero", async () => {
    const door = memoryDoorLedger();
    unwrap(await door.port.appendPreDoorRefusal({ home: HOME, refusal }));
    expect(unwrap(await door.port.readRecentPreDoorRefusals({ home: HOME, limit: 0 }))).toStrictEqual([]);
  });
});

describe("aboveFoldRefusalRow", () => {
  it("builds no row when nothing was refused", () => {
    expect(
      aboveFoldRefusalRow({ runId: "r", tsIso: "2026-09-19T00:00:00.000Z", verdict: verdictWith({ refusals: [] }) }),
    ).toBeUndefined();
  });

  it("names the surface the body was judged for and the hatch that would have let it through", () => {
    const row = aboveFoldRefusalRow({
      runId: "r",
      tsIso: "2026-09-19T00:00:00.000Z",
      verdict: verdictWith({ refusals: ["headline: no"] }),
    });
    expect(row!.surface).toBe("slack");
    expect(row!.hatch).toBe("voice-rules");
    expect(row!.gate).toBe("above-the-fold-voice");
    expect(row!.findings).toStrictEqual([{ code: "voice-rule", message: "m", path: "headline" }]);
  });
});

describe("printedAboveFoldRefusals", () => {
  it("writes the refusal row the ledger had none of, and the reader finds it", async () => {
    const door = memoryDoorLedger();
    const lines: string[] = [];
    const refused = await printedAboveFoldRefusals({
      home: HOME,
      ledger: door.port,
      out: ({ line }) => {
        lines.push(line);
      },
      runId: "r-live",
      tsIso: "2026-09-19T04:00:00.000Z",
      verdict: verdictWith({ refusals: ["headline: a colon introducing a list"] }),
    });
    expect(refused).toBe(true);
    expect(lines[0]).toBe("refused: headline: a colon introducing a list");
    const read = unwrap(await door.port.readRecentPreDoorRefusals({ home: HOME, limit: 10 }));
    expect(read.map((entry) => [entry.runId, entry.tsIso])).toStrictEqual([["r-live", "2026-09-19T04:00:00.000Z"]]);
  });

  it("writes NOTHING when the body passes, so the ledger counts refusals rather than checks", async () => {
    const door = memoryDoorLedger();
    const refused = await printedAboveFoldRefusals({
      home: HOME,
      ledger: door.port,
      out: () => {},
      verdict: verdictWith({ refusals: [] }),
    });
    expect(refused).toBe(false);
    expect(door.records()).toStrictEqual([]);
  });
});

describe("the report's own honesty", () => {
  it("names the one gate that writes a row and says an empty result proves nothing", () => {
    const lines = preDoorRefusalCoverageLines().join(" ");
    expect(lines).toContain("above-the-fold voice gate");
    expect(lines).toContain("does NOT mean nothing");
    expect(lines).toContain("the list is not closed");
  });

  it("renders a row with its instant, its surface and one line per finding", () => {
    expect(preDoorRefusalLines({ entry: { ...refusal } })).toStrictEqual([
      "2026-09-19T01:00:00.000Z  above-the-fold-voice refused a slack body " + "(hatch voice-rules, run r-1)",
      '    voice-rule at headline: matches the configured literal voice rule "—". Rewrite it.',
      "    colon-list at detail: a colon introducing a list packs several facts into one sentence.",
    ]);
  });
});

describe("the fleet projector reads a refusal row rather than refusing it", () => {
  const line = JSON.stringify(preDoorRefusalRecord({ refusal }));

  it("projects the line into a door_event carrying the gate as its action and `refused` as its status", () => {
    const projected = projectDoorLine({
      guardIso: "2026-09-03T17:08:55.922Z",
      line,
      lineNumber: 1,
      path: "/tmp/door.jsonl",
    });
    expect(projected.isOk()).toBe(true);
    const row = unwrap(projected);
    expect(row.action).toBe("gate:above-the-fold-voice");
    expect(row.status).toBe("refused");
    expect(row.duplicateKey).toBe(null);
    expect(row.findings).toHaveLength(2);
  });

  it("reads a refusal row written before the action field as the very action the builder writes", () => {
    const { action, ...withoutAction } = JSON.parse(line) as Record<string, unknown>;
    expect(action).toBe("gate:above-the-fold-voice");
    const projected = projectDoorLine({
      guardIso: "2026-09-03T17:08:55.922Z",
      line: JSON.stringify(withoutAction),
      lineNumber: 1,
      path: "/tmp/door.jsonl",
    });
    expect(projected.isOk()).toBe(true);
    expect(unwrap(projected).action).toBe(action);
  });

  it("still refuses a refusal row that carries neither the action nor the gate", () => {
    const { action, gate, ...withNeither } = JSON.parse(line) as Record<string, unknown>;
    expect([action, gate]).toStrictEqual(["gate:above-the-fold-voice", "above-the-fold-voice"]);
    const projected = projectDoorLine({
      guardIso: "2026-09-03T17:08:55.922Z",
      line: JSON.stringify(withNeither),
      lineNumber: 1,
      path: "/tmp/door.jsonl",
    });
    expect(projected.isErr()).toBe(true);
    expect(unwrapErr(projected).code).toBe("MISSING_FIELD");
  });
});
