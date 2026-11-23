/**
 * The steer-measurement port's orchestration over the in-memory store (`../../steerMeasurementFixture.ts`, a seam,
 * not a mock): the one-time import and its witness, an empty register against an outage against no store, the
 * marker refusals, an append that imports first, a racing append, and the export's transfer port. What only
 * Postgres proves — the triggers, the lock, the CHECKs — is `integration/steerMeasurementStore.test.ts`.
 *
 * Every journal this file writes sits under a `home` it minted, never the ambient one.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { type SteerVerdict, steerVerdictLine } from "../../../profile/steerKinds.js";
import { importedSteerEventId } from "../../../profile/steerMeasurementRecords.js";
import {
  storeSteerMeasurementPort,
  storeSteerMeasurementTransferPort,
} from "../../../profile/steerMeasurementStore.js";
import { scriptedStoreClient } from "../../scriptedStoreClient.js";
import { steerMeasurementFake } from "../../steerMeasurementFixture.js";

const VERDICT: SteerVerdict = {
  anchor: "talk:a0000017-0000-4000-8000-000000000019",
  judgedAtIso: "2026-10-04T12:00:00.000Z",
  says: "nothing",
  turnAtIso: "2026-10-04T09:00:00.000Z",
};
const LINE = steerVerdictLine({ verdict: VERDICT });

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-steer-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Where the old journal lives under this test's home. */
function journalPath(): string {
  return join(home, "judgement", "steer-kinds.jsonl");
}

/** Write the old journal under this test's home. */
function writeJournal({ text }: { text: string }): void {
  mkdirSync(join(home, "judgement"), { recursive: true });
  writeFileSync(journalPath(), text, "utf8");
}

describe("reading the history", () => {
  it("reads an empty register as nothing judged, marking a journal that was never there", async () => {
    const fake = steerMeasurementFake();

    expect(unwrap(await fake.port.readHistory({ home }))).toEqual({ unparsed: [], verdicts: [] });
    expect(fake.state.marker).toEqual({ records: 0, source: { state: "absent" } });
    expect(fake.state.closes).toBe(1);
  });

  it("imports the old journal once, then reads it from the store while the file is unchanged", async () => {
    writeJournal({ text: `${LINE}\n` });
    const fake = steerMeasurementFake();

    expect(unwrap(await fake.port.readHistory({ home }))).toEqual({ unparsed: [], verdicts: [VERDICT] });
    expect(unwrap(await fake.port.readHistory({ home }))).toEqual({ unparsed: [], verdicts: [VERDICT] });
    expect(fake.state.rows.map((row) => row.eventId)).toEqual([
      importedSteerEventId({ exactLine: LINE, sourceOrdinal: 1 }),
    ]);
    expect(fake.state.marker!.records).toBe(1);
  });

  it("goes on reading once the imported file is removed: the old path is retired", async () => {
    writeJournal({ text: `${LINE}\n` });
    const fake = steerMeasurementFake();
    unwrap(await fake.port.readHistory({ home }));
    unlinkSync(journalPath());

    expect(unwrap(await fake.port.readHistory({ home })).verdicts).toEqual([VERDICT]);
  });

  it("refuses once the imported file changes, since an append there would be lost", async () => {
    writeJournal({ text: `${LINE}\n` });
    const fake = steerMeasurementFake();
    unwrap(await fake.port.readHistory({ home }));
    writeJournal({ text: `${LINE}\n${LINE}\n` });

    const refused = unwrapErr(await fake.port.readHistory({ home }));

    expect(refused.code).toBe("STEER_HOME_FILE_CHANGED_AFTER_IMPORT");
    expect(refused.message).toContain(
      `${journalPath()} is not the file the store imported its steer measurements from`,
    );
  });

  it("refuses a journal appended while the store was being read, rather than reading around the append", async () => {
    writeJournal({ text: `${LINE}\n` });
    const fake = steerMeasurementFake();
    unwrap(await fake.port.readHistory({ home }));
    const port = storeSteerMeasurementPort({
      seams: {
        ...fake.seams,
        connect: async (request) => {
          const rows = unwrap(await fake.seams.connect(request));
          return ok({
            ...rows,
            readStored: async () => {
              writeJournal({ text: `${LINE}\n${LINE}\n` });
              return rows.readStored();
            },
          });
        },
      },
    });

    expect(unwrapErr(await port.readHistory({ home })).code).toBe("STEER_HOME_FILE_CHANGED_AFTER_IMPORT");
  });

  it("refuses a journal that appears after an import found none", async () => {
    const fake = steerMeasurementFake();
    unwrap(await fake.port.readHistory({ home }));
    writeJournal({ text: `${LINE}\n` });

    expect(unwrapErr(await fake.port.readHistory({ home })).code).toBe("STEER_HOME_FILE_CHANGED_AFTER_IMPORT");
  });

  it("refuses a journal that is a link, importing nothing", async () => {
    mkdirSync(join(home, "judgement"), { recursive: true });
    writeFileSync(join(home, "elsewhere.jsonl"), `${LINE}\n`, "utf8");
    symlinkSync(join(home, "elsewhere.jsonl"), journalPath());
    const fake = steerMeasurementFake();

    const refused = unwrapErr(await fake.port.readHistory({ home }));

    expect(refused.code).toBe("STEER_HOME_FILE_UNREADABLE");
    expect(refused.message).toContain(`the steer-kind journal ${journalPath()} would not read`);
    expect(fake.state.rows).toEqual([]);
  });

  it("refuses an outage rather than reading it as an empty register", async () => {
    const fake = steerMeasurementFake({ connection: "unavailable" });

    expect(unwrapErr(await fake.port.readHistory({ home }))).toEqual({
      code: "STEER_STORE_UNAVAILABLE",
      message: "the store could not be opened: connection refused",
    });
  });

  it("refuses a register that lost an imported line, naming both counts", async () => {
    writeJournal({ text: `${LINE}\nnot json\n` });
    const fake = steerMeasurementFake();
    unwrap(await fake.port.readHistory({ home }));
    fake.state.rows.pop();

    const refused = unwrapErr(await fake.port.readHistory({ home }));

    expect(refused).toEqual({
      code: "STEER_IMPORT_MARKER_INCONSISTENT",
      expected: 2,
      message: "the steer-measurement import marker says 2 line(s) were imported, and the table holds 1",
      observed: 1,
    });
  });
});

describe("reading with no store selected", () => {
  it("reads nothing judged when no journal waits either", async () => {
    const fake = steerMeasurementFake({ connection: "unselected" });

    expect(unwrap(await fake.port.readHistory({ home }))).toEqual({ unparsed: [], verdicts: [] });
  });

  it("refuses when a journal waits to be imported, never reading it from the file", async () => {
    writeJournal({ text: `${LINE}\n` });
    const fake = steerMeasurementFake({ connection: "unselected" });

    expect(unwrapErr(await fake.port.readHistory({ home }))).toEqual({
      code: "STEER_STORE_UNSELECTED",
      message:
        "steer measurements wait in judgement/steer-kinds.jsonl to be imported, and this home selects no store: no store is configured",
      selection: "no store is configured",
    });
  });

  it("refuses a journal that would not read, rather than reading it as nothing judged", async () => {
    mkdirSync(join(home, "judgement"), { recursive: true });
    writeFileSync(join(home, "elsewhere.jsonl"), `${LINE}\n`, "utf8");
    symlinkSync(join(home, "elsewhere.jsonl"), journalPath());
    const fake = steerMeasurementFake({ connection: "unselected" });

    const refused = unwrapErr(await fake.port.readHistory({ home }));

    expect(refused.code).toBe("STEER_HOME_FILE_UNREADABLE");
    expect(refused.message).toContain(`the steer-kind journal ${journalPath()} would not read`);
  });
});

describe("appending a verdict", () => {
  it("imports the old journal first, then appends one past its last line", async () => {
    writeJournal({ text: `\n${LINE}\n` });
    const fake = steerMeasurementFake();

    const written = unwrap(await fake.port.append({ home, verdict: VERDICT }));

    expect(written).toEqual({
      eventId: "steer-event-00000000-0000-4000-8000-000000000001",
      journalSeq: 3,
      kind: "written",
    });
    expect(fake.state.rows.map((row) => [row.journalSeq, row.origin])).toEqual([
      [2, "legacy-file"],
      [3, "profile"],
    ]);
    expect(unwrap(await fake.port.readHistory({ home })).verdicts).toEqual([VERDICT, VERDICT]);
  });

  it("refuses an append a racing appender beat, writing nothing", async () => {
    const fake = steerMeasurementFake();
    fake.state.raceNextAppend = true;

    expect(unwrapErr(await fake.port.append({ home, verdict: VERDICT })).code).toBe("STEER_APPEND_CONFLICT");
    expect(fake.state.rows).toEqual([]);
    expect(fake.state.closes).toBe(1);
  });

  it("refuses an append into a changed journal, writing nothing", async () => {
    writeJournal({ text: `${LINE}\n` });
    const fake = steerMeasurementFake();
    unwrap(await fake.port.readHistory({ home }));
    writeJournal({ text: "" });

    expect(unwrapErr(await fake.port.append({ home, verdict: VERDICT })).code).toBe(
      "STEER_HOME_FILE_CHANGED_AFTER_IMPORT",
    );
    expect(fake.state.rows.map((row) => row.origin)).toEqual(["legacy-file"]);
  });
});

describe("the export's transfer port", () => {
  it("imports over the export's connection, then reads every stored line from its snapshot as its envelope", async () => {
    writeJournal({ text: `${LINE}\nnot json\n` });
    const fake = steerMeasurementFake();
    const rows = unwrap(await fake.seams.connect({ home }));
    const { client } = scriptedStoreClient({ answer: () => [] });
    const transfer = storeSteerMeasurementTransferPort({
      seams: { readHomeFile: fake.seams.readHomeFile, readSnapshot: () => rows.readStored(), rowsOver: () => rows },
    });

    expect(unwrap(await transfer.ensureImported({ client, home }))).toBe(undefined);
    const envelopes = unwrap(await transfer.readPortableLines({ reader: client })).map(
      (line) => JSON.parse(line) as { exactText: string; sourceOrdinal: number | null; parseStatus: string },
    );
    expect(envelopes.map((envelope) => [envelope.exactText, envelope.sourceOrdinal, envelope.parseStatus])).toEqual([
      [LINE, 1, "parsed"],
      ["not json", 2, "unparsed"],
    ]);
  });

  it("refuses when the marker the import wrote is gone by the witness check", async () => {
    const fake = steerMeasurementFake();
    const rows = unwrap(await fake.seams.connect({ home }));
    const { client } = scriptedStoreClient({ answer: () => [] });
    const transfer = storeSteerMeasurementTransferPort({
      seams: {
        readHomeFile: fake.seams.readHomeFile,
        readSnapshot: () => rows.readStored(),
        rowsOver: () => ({ ...rows, markedSource: async () => ok(undefined) }),
      },
    });

    expect(unwrapErr(await transfer.ensureImported({ client, home }))).toEqual({
      code: "STEER_STORE_UNAVAILABLE",
      message: "the store could not read the steer-measurement import marker: the marker the import wrote is gone",
    });
  });
});
