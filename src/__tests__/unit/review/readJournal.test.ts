import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { DEFAULT_CADENCE_MINUTES, MAX_CADENCE_MINUTES } from "../../../review/readCadence.js";
import {
  decodeReadDocument,
  decodeReadRecord,
  type ReadRecord,
  readDue,
  selectionKey,
} from "../../../review/readJournal.js";
import { storeReadJournalPort } from "../../../review/readJournalPort.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  memoryReadJournalPort,
  memoryReadJournalSeams,
  memoryReadStore,
  unavailableReadJournalPort,
} from "../../landingRegistersFixture.js";

const SELECTION = "acme/widgets@ada";

const record = ({ atIso, selection = SELECTION }: { atIso: string; selection?: string }): ReadRecord => ({
  atIso,
  dispatchable: 2,
  rows: 9,
  selection,
});

/** The register as the read port's `readLatest` would answer it, built without a store. */
const reads = ({ records }: { records: readonly ReadRecord[] }): ReadonlyMap<string, ReadRecord> =>
  new Map(records.map((one) => [one.selection, one]));

describe("selectionKey", () => {
  it("is order-insensitive, so the same two repositories typed either way are ONE selection", () => {
    expect(selectionKey({ author: "ada", repos: ["acme/b", "acme/a"] })).toBe(
      selectionKey({ author: "ada", repos: ["acme/a", "acme/b"] }),
    );
  });

  it("lower-cases both halves, so a differently-cased login is not a second selection", () => {
    expect(selectionKey({ author: "Ada", repos: ["Acme/Widgets"] })).toBe("acme/widgets@ada");
  });

  it("spells an absent author `*` rather than dropping the field", () => {
    expect(selectionKey({ author: undefined, repos: ["acme/widgets"] })).toBe("acme/widgets@*");
  });

  it("separates two selections that differ only by author", () => {
    expect(selectionKey({ author: "a", repos: ["acme/widgets"] })).not.toBe(
      selectionKey({ author: "b", repos: ["acme/widgets"] }),
    );
  });

  it("files a drafts-only read under its own key, so it never spends the press read's cadence", () => {
    expect(selectionKey({ author: "@me", draftsOnly: true, repos: ["acme/widgets"] })).toBe("acme/widgets@@me#drafts");
    expect(selectionKey({ author: "@me", repos: ["acme/widgets"] })).toBe("acme/widgets@@me");
  });
});

describe("decodeReadRecord", () => {
  it("decodes a well-formed entry, filed under its selection", () => {
    const entry = { atIso: "2026-09-19T01:00:00.000Z", dispatchable: 2, rows: 9 };
    expect(unwrap(decodeReadRecord({ entry, selection: SELECTION }))).toEqual(
      record({ atIso: "2026-09-19T01:00:00.000Z" }),
    );
  });

  it("refuses an entry whose instant will not parse, because the gate compares instants", () => {
    const entry = { atIso: "yesterdayish", dispatchable: 0, rows: 0 };
    expect(unwrapErr(decodeReadRecord({ entry, selection: SELECTION })).message).toBe("carries no parseable atIso");
  });

  it("refuses an impossible calendar day, which Date.parse would roll into the next month and so make a read due", () => {
    const entry = { atIso: "2026-02-30T00:00:00.000Z", dispatchable: 0, rows: 0 };
    expect(unwrapErr(decodeReadRecord({ entry, selection: SELECTION })).message).toBe("carries no parseable atIso");
  });

  it("refuses absent counts rather than inventing zeroes for them", () => {
    const entry = { atIso: "2026-09-19T01:00:00.000Z" };
    expect(unwrapErr(decodeReadRecord({ entry, selection: SELECTION })).message).toBe(
      "carries no non-negative integer rows",
    );
  });

  it("refuses more dispatchable rows than rows", () => {
    const entry = { atIso: "2026-09-19T01:00:00.000Z", dispatchable: 3, rows: 2 };
    expect(unwrapErr(decodeReadRecord({ entry, selection: SELECTION })).message).toBe(
      "claims more dispatchable rows than rows",
    );
  });

  it("refuses an empty selection", () => {
    const entry = { atIso: "2026-09-19T01:00:00.000Z", dispatchable: 0, rows: 0 };
    expect(unwrapErr(decodeReadRecord({ entry, selection: "" })).message).toBe("is filed under an empty selection");
  });

  it.each([
    ["a trailing space", "acme/widgets@ada "],
    ["an upper-case login", "acme/widgets@Ada"],
    ["an unsorted repository list", "acme/b,acme/a@ada"],
    ["a slug with no owner", "widgets@ada"],
    ["no author half", "acme/widgets"],
    ["an empty author", "acme/widgets@"],
    ["a doubled drafts suffix", "acme/widgets@@me#drafts#drafts"],
    ["a drafts suffix with no author", "acme/widgets@#drafts"],
  ])("refuses a selection no invocation spells: %s", (_why, selection) => {
    const entry = { atIso: "2026-09-19T01:00:00.000Z", dispatchable: 0, rows: 0 };
    expect(unwrapErr(decodeReadRecord({ entry, selection })).code).toBe("READ_SELECTION_NOT_CANONICAL");
  });

  it.each([["acme/a,acme/b@ada"], ["acme/widgets@*"], ["acme/widgets@@me"], ["acme/widgets@@me#drafts"], ["@ada"]])(
    "accepts the canonical selection %s",
    (selection) => {
      const entry = { atIso: "2026-09-19T01:00:00.000Z", dispatchable: 0, rows: 0 };
      expect(unwrap(decodeReadRecord({ entry, selection })).selection).toBe(selection);
    },
  );
});

describe("decodeReadDocument", () => {
  it("keeps one entry per selection, keyed as the file keys it", () => {
    const decoded = decodeReadDocument({
      value: {
        "acme/other@ada": { atIso: "2026-09-19T02:00:00.000Z", dispatchable: 1, rows: 4 },
        "acme/widgets@ada": { atIso: "2026-09-19T01:00:00.000Z", dispatchable: 2, rows: 9 },
      },
    });
    expect(unwrap(decoded).map((one) => one.selection)).toEqual(["acme/other@ada", "acme/widgets@ada"]);
  });

  it("refuses a document that is not a record at all", () => {
    expect(unwrapErr(decodeReadDocument({ value: "nonsense" }))).toEqual(["the document is not an object"]);
  });

  it("refuses the whole document on one bad entry, naming it, rather than reading around it", () => {
    const decoded = decodeReadDocument({
      value: { "acme/broken@ada": 7, [SELECTION]: { atIso: "2026-09-19T01:00:00.000Z", dispatchable: 0, rows: 0 } },
    });
    expect(unwrapErr(decoded)).toEqual(['"acme/broken@ada" is not an object']);
  });
});

describe("readDue", () => {
  const now = new Date("2026-09-19T12:00:00.000Z");

  it("is DUE when nothing was ever recorded for this selection", () => {
    const verdict = readDue({ cadenceMinutes: 30, now, reads: new Map(), selection: SELECTION });
    expect(verdict).toEqual({
      kind: "due",
      lastReadAtIso: undefined,
      why: "no fleet read is recorded for acme/widgets@ada",
    });
  });

  it("is DUE when another selection was read but this one was not", () => {
    const map = reads({ records: [record({ atIso: "2026-09-19T11:59:00.000Z", selection: "acme/other@ada" })] });
    expect(readDue({ cadenceMinutes: 30, now, reads: map, selection: SELECTION }).kind).toBe("due");
  });

  it("SKIPS inside the cadence, naming when it is next due", () => {
    const map = reads({ records: [record({ atIso: "2026-09-19T11:50:00.000Z" })] });
    expect(readDue({ cadenceMinutes: 30, now, reads: map, selection: SELECTION })).toEqual({
      kind: "skip",
      lastReadAtIso: "2026-09-19T11:50:00.000Z",
      nextDueAtIso: "2026-09-19T12:20:00.000Z",
      why:
        "acme/widgets@ada was read 10 minute(s) ago and the cadence is 30 minute(s), so this tick makes " +
        "no GitHub request",
    });
  });

  it("is DUE exactly ON the boundary, so a cadence of N minutes reads every N", () => {
    const map = reads({ records: [record({ atIso: "2026-09-19T11:30:00.000Z" })] });
    expect(readDue({ cadenceMinutes: 30, now, reads: map, selection: SELECTION }).kind).toBe("due");
  });

  it("is DUE when the cadence puts the next read past the range a date can express", () => {
    const map = reads({ records: [record({ atIso: "2026-09-19T11:50:00.000Z" })] });
    expect(readDue({ cadenceMinutes: 999_999_999_999, now, reads: map, selection: SELECTION })).toEqual({
      kind: "due",
      lastReadAtIso: "2026-09-19T11:50:00.000Z",
      why:
        "a cadence of 999999999999 minute(s) puts the next read for acme/widgets@ada outside the range a " +
        "date can express, and an unnameable next read must not hold this one shut",
    });
  });

  it("still SKIPS at the largest cadence the verb accepts, so the guard has not swallowed a real window", () => {
    const map = reads({ records: [record({ atIso: "2026-09-19T11:50:00.000Z" })] });
    expect(readDue({ cadenceMinutes: MAX_CADENCE_MINUTES, now, reads: map, selection: SELECTION })).toEqual({
      kind: "skip",
      lastReadAtIso: "2026-09-19T11:50:00.000Z",
      nextDueAtIso: "2026-09-26T11:50:00.000Z",
      why:
        "acme/widgets@ada was read 10 minute(s) ago and the cadence is 10080 minute(s), so this tick " +
        "makes no GitHub request",
    });
  });

  it("caps the accepted cadence at seven days", () => {
    expect(MAX_CADENCE_MINUTES).toBe(10_080);
  });

  it("is DUE when the newest record is in the FUTURE, so a backwards clock cannot wedge the read shut", () => {
    const map = reads({ records: [record({ atIso: "2026-09-20T00:00:00.000Z" })] });
    expect(readDue({ cadenceMinutes: 30, now, reads: map, selection: SELECTION })).toEqual({
      kind: "due",
      lastReadAtIso: "2026-09-20T00:00:00.000Z",
      why:
        "the newest recorded read for acme/widgets@ada is dated 2026-09-20T00:00:00.000Z, which is in the " +
        "future — a clock that moved backwards must not hold the read shut",
    });
  });

  it("honours a cadence the caller chose over the default", () => {
    const map = reads({ records: [record({ atIso: "2026-09-19T11:50:00.000Z" })] });
    expect(readDue({ cadenceMinutes: 5, now, reads: map, selection: SELECTION }).kind).toBe("due");
  });

  it("holds the default cadence at thirty minutes", () => {
    expect(DEFAULT_CADENCE_MINUTES).toBe(30);
  });
});

describe("the store-backed read cursor", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  const freshHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), "landing-reads-"));
    homes.push(home);
    return home;
  };

  it("round-trips a recorded read", async () => {
    const home = freshHome();
    const port = memoryReadJournalPort();
    unwrap(await port.record({ home, record: record({ atIso: "2026-09-19T01:00:00.000Z" }) }));
    expect(unwrap(await port.readLatest({ home })).get(SELECTION)).toEqual(
      record({ atIso: "2026-09-19T01:00:00.000Z" }),
    );
  });

  it("REPLACES a selection's row rather than appending, advancing its revision", async () => {
    const home = freshHome();
    const store = memoryReadStore();
    const port = memoryReadJournalPort({ store });
    unwrap(await port.record({ home, record: record({ atIso: "2026-09-19T01:00:00.000Z" }) }));
    unwrap(await port.record({ home, record: record({ atIso: "2026-09-19T02:00:00.000Z" }) }));
    expect([...store.rows.values()]).toEqual([
      { atIso: "2026-09-19T02:00:00.000Z", dispatchable: 2, revision: 2, rows: 9, selection: SELECTION },
    ]);
  });

  it("keeps another selection's row when one is recorded", async () => {
    const home = freshHome();
    const port = memoryReadJournalPort();
    unwrap(await port.record({ home, record: record({ atIso: "2026-09-19T01:00:00.000Z" }) }));
    unwrap(
      await port.record({
        home,
        record: record({ atIso: "2026-09-19T02:00:00.000Z", selection: "acme/other@ada" }),
      }),
    );
    expect([...unwrap(await port.readLatest({ home })).keys()].toSorted()).toEqual([
      "acme/other@ada",
      "acme/widgets@ada",
    ]);
  });

  it("answers NOTHING RECORDED on an empty store with no old file, which makes every selection due", async () => {
    expect(unwrap(await memoryReadJournalPort().readLatest({ home: freshHome() })).size).toBe(0);
  });

  it("imports the old file once, each selection at revision 1", async () => {
    const home = freshHome();
    writeFileSync(
      stateHomePaths({ home }).landingReadsJson,
      JSON.stringify({ [SELECTION]: { atIso: "2026-09-19T01:00:00.000Z", dispatchable: 2, rows: 9 } }),
    );
    const store = memoryReadStore();
    const port = memoryReadJournalPort({ store });
    unwrap(await port.readLatest({ home }));
    writeFileSync(stateHomePaths({ home }).landingReadsJson, "{}");
    expect(unwrap(await port.readLatest({ home })).get(SELECTION)).toEqual(
      record({ atIso: "2026-09-19T01:00:00.000Z" }),
    );
    expect(store.rows.get(SELECTION)!.revision).toBe(1);
    expect(store.importedRecords).toBe(1);
  });

  it("refuses an old file that is not JSON, rather than answering every selection due", async () => {
    const home = freshHome();
    writeFileSync(stateHomePaths({ home }).landingReadsJson, "{\n{\n", "utf8");
    const store = memoryReadStore();
    const error = unwrapErr(await memoryReadJournalPort({ store }).readLatest({ home }));
    expect(error.code).toBe("READ_IMPORT_INVALID");
    expect(error.message).toContain("the document is not JSON");
    expect(store.imported).toBe(false);
  });

  it("refuses to read past a corrupt stored row", async () => {
    const store = memoryReadStore();
    store.imported = true;
    store.rows.set(SELECTION, { atIso: "nope", dispatchable: 0, revision: 1, rows: 0, selection: SELECTION });
    const error = unwrapErr(await memoryReadJournalPort({ store }).readLatest({ home: freshHome() }));
    expect(error.message).toBe(
      "the stored landing read for acme/widgets@ada carries no parseable atIso, so the cadence cannot be judged",
    );
  });

  it("refuses to write over a corrupt stored row, and leaves it in place as the evidence", async () => {
    const store = memoryReadStore();
    store.imported = true;
    const corrupt = { atIso: "nope", dispatchable: 0, revision: 1, rows: 0, selection: SELECTION };
    store.rows.set(SELECTION, corrupt);
    const port = memoryReadJournalPort({ store });
    const error = unwrapErr(
      await port.record({ home: freshHome(), record: record({ atIso: "2026-09-19T01:00:00.000Z" }) }),
    );
    expect(error.code).toBe("READ_RECORD_INVALID");
    expect(store.rows.get(SELECTION)).toEqual(corrupt);
  });

  it("refuses a stored row whose revision is not positive, on read and on write, and leaves it in place", async () => {
    const store = memoryReadStore();
    store.imported = true;
    const corrupt = { ...record({ atIso: "2026-09-19T00:00:00.000Z" }), revision: 0 };
    store.rows.set(SELECTION, corrupt);
    const port = memoryReadJournalPort({ store });
    const read = unwrapErr(await port.readLatest({ home: freshHome() }));
    expect(read.message).toBe(
      "the stored landing read for acme/widgets@ada carries revision 0, which is not a positive whole number, so the cadence cannot be judged",
    );
    const write = unwrapErr(
      await port.record({ home: freshHome(), record: record({ atIso: "2026-09-19T01:00:00.000Z" }) }),
    );
    expect(write.code).toBe("READ_RECORD_INVALID");
    expect(store.rows.get(SELECTION)).toEqual(corrupt);
  });

  it("refuses an invalid read before it writes anything", async () => {
    const store = memoryReadStore();
    const invalid = { ...record({ atIso: "2026-09-19T01:00:00.000Z" }), dispatchable: 10 };
    const error = unwrapErr(await memoryReadJournalPort({ store }).record({ home: freshHome(), record: invalid }));
    expect(error.code).toBe("READ_RECORD_INVALID");
    expect(store.rows.size).toBe(0);
  });

  it("refuses, and never retries, when another writer lands between the read and the compare-and-set", async () => {
    const home = freshHome();
    const store = memoryReadStore();
    const port = memoryReadJournalPort({ store });
    unwrap(await port.record({ home, record: record({ atIso: "2026-09-19T01:00:00.000Z" }) }));
    const seams = memoryReadJournalSeams({ store });
    const racing = storeReadJournalPort({
      seams: {
        ...seams,
        connect: async (request) => {
          const rows = unwrap(await seams.connect(request));
          return ok({
            ...rows,
            readSelection: async (selected) => {
              const seen = await rows.readSelection(selected);
              unwrap(await port.record({ home, record: record({ atIso: "2026-09-19T03:00:00.000Z" }) }));
              return seen;
            },
          });
        },
      },
    });
    const error = unwrapErr(await racing.record({ home, record: record({ atIso: "2026-09-19T02:00:00.000Z" }) }));
    expect(error.code).toBe("READ_REVISION_CONFLICT");
    expect(error.message).toContain("(read at revision 1)");
    expect(store.rows.get(SELECTION)).toEqual({
      atIso: "2026-09-19T03:00:00.000Z",
      dispatchable: 2,
      revision: 2,
      rows: 9,
      selection: SELECTION,
    });
  });

  it("refuses with the store's outage, never an answer that every selection is due", async () => {
    const error = unwrapErr(await unavailableReadJournalPort().readLatest({ home: freshHome() }));
    expect(error.code).toBe("READ_STORE_UNAVAILABLE");
  });
});
