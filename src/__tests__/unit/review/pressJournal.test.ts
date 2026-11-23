import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import {
  decodePressRecord,
  latestPresses,
  type PressRecord,
  pressFor,
  pressKey,
} from "../../../review/pressJournal.js";
import {
  type PressJournalRows,
  type PressJournalSeams,
  storePressJournalPort,
} from "../../../review/pressJournalPort.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  memoryPressJournalPort,
  memoryPressRows,
  memoryPressStore,
  unavailablePressJournalPort,
} from "../../landingRegistersFixture.js";

const HEAD_A = "1111111111111111111111111111111111111111";
const HEAD_B = "2222222222222222222222222222222222222222";

const record = ({
  atIso,
  headOid = HEAD_A,
  number = 16378,
}: {
  atIso: string;
  headOid?: string;
  number?: number;
}): PressRecord => ({
  atIso,
  entryState: "QUEUED",
  headOid,
  number,
  repoSlug: "acme/widgets",
});

describe("decodePressRecord", () => {
  it("decodes a well-formed press to exactly its five fields", () => {
    const decoded = decodePressRecord({ value: { ...record({ atIso: "2026-09-09T12:00:00.000Z" }), extra: 1 } });
    expect(unwrap(decoded)).toEqual(record({ atIso: "2026-09-09T12:00:00.000Z" }));
  });

  it("refuses a press with no head, because an eviction can never be judged against one", () => {
    const value = { atIso: "2026-09-09T12:00:00.000Z", entryState: "", number: 1, repoSlug: "a/b" };
    expect(unwrapErr(decodePressRecord({ value })).message).toBe("carries no headOid");
  });

  it("refuses an instant that will not parse", () => {
    expect(unwrapErr(decodePressRecord({ value: record({ atIso: "x" }) })).message).toBe("carries no parseable atIso");
  });

  it("refuses an impossible calendar day, which Date.parse would quietly roll into the next month", () => {
    const decoded = decodePressRecord({ value: record({ atIso: "2026-02-30T00:00:00.000Z" }) });
    expect(unwrapErr(decoded).message).toBe("carries no parseable atIso");
  });

  it("refuses a number that is not a positive integer", () => {
    const value = { ...record({ atIso: "2026-09-09T12:00:00.000Z" }), number: 0 };
    expect(unwrapErr(decodePressRecord({ value })).message).toBe("carries no positive integer number");
  });

  it.each(["acme/widgets ", "acme/widgets/extra", ""])(
    "refuses the slug %j, which files under a key no landing lookup spells",
    (repoSlug) => {
      const value = { ...record({ atIso: "2026-09-09T12:00:00.000Z" }), repoSlug };
      expect(unwrapErr(decodePressRecord({ value })).message).toBe("carries no owner/name repoSlug");
    },
  );

  it("refuses a value that is not an object", () => {
    expect(unwrapErr(decodePressRecord({ value: "not a press" })).message).toBe("is not an object");
  });
});

describe("pressKey", () => {
  it("is the same for the same press and different for a different head", () => {
    const first = pressKey({ record: record({ atIso: "2026-09-09T12:00:00.000Z" }) });
    expect(pressKey({ record: record({ atIso: "2026-09-09T12:00:00.000Z" }) })).toBe(first);
    expect(pressKey({ record: record({ atIso: "2026-09-09T12:00:00.000Z", headOid: HEAD_B }) })).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("ignores the entry state, so a re-recorded press with a different read-back is the SAME key", () => {
    const pressed = record({ atIso: "2026-09-09T12:00:00.000Z" });
    expect(pressKey({ record: { ...pressed, entryState: "" } })).toBe(pressKey({ record: pressed }));
  });
});

describe("latestPresses", () => {
  it("keeps the newest press per pull request, so an eviction is judged against the current one", () => {
    const presses = latestPresses({
      records: [
        record({ atIso: "2026-09-09T12:00:00.000Z", headOid: HEAD_A }),
        record({ atIso: "2026-09-09T13:00:00.000Z", headOid: HEAD_B }),
      ],
    });
    expect(pressFor({ number: 16378, presses, repoSlug: "acme/widgets" })!.headOid).toBe(HEAD_B);
  });

  it("gives an equal instant to the later record, which is why the store reads in insertion order", () => {
    const presses = latestPresses({
      records: [
        record({ atIso: "2026-09-09T12:00:00.000Z", headOid: HEAD_A }),
        record({ atIso: "2026-09-09T12:00:00.000Z", headOid: HEAD_B }),
      ],
    });
    expect(pressFor({ number: 16378, presses, repoSlug: "acme/widgets" })!.headOid).toBe(HEAD_B);
  });

  it("keys presses by repository as well as number", () => {
    const presses = latestPresses({
      records: [
        record({ atIso: "2026-09-09T12:00:00.000Z" }),
        { ...record({ atIso: "2026-09-09T12:00:00.000Z", headOid: HEAD_B }), repoSlug: "acme/other" },
      ],
    });
    expect(pressFor({ number: 16378, presses, repoSlug: "acme/other" })!.headOid).toBe(HEAD_B);
  });

  it("has nothing for a pull request that was never pressed", () => {
    expect(pressFor({ number: 99, presses: latestPresses({ records: [] }), repoSlug: "acme/widgets" })).toBe(undefined);
  });
});

describe("the store-backed press register", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  const freshHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), "press-"));
    homes.push(home);
    return home;
  };

  it("round-trips an appended press through the store", async () => {
    const home = freshHome();
    const presses = memoryPressJournalPort();
    expect(unwrap(await presses.append({ home, record: record({ atIso: "2026-09-09T12:00:00.000Z" }) }))).toBe(
      undefined,
    );
    const latest = unwrap(await presses.readLatest({ home }));
    expect(pressFor({ number: 16378, presses: latest, repoSlug: "acme/widgets" })).toEqual({
      atIso: "2026-09-09T12:00:00.000Z",
      headOid: HEAD_A,
    });
  });

  it("answers nothing recorded on an empty store with no old file, and marks the import done", async () => {
    const store = memoryPressStore();
    const latest = unwrap(await memoryPressJournalPort({ store }).readLatest({ home: freshHome() }));
    expect(latest.size).toBe(0);
    expect(store.imported).toBe(true);
    expect(store.importedRecords).toBe(0);
  });

  it("imports the old file ONCE, so a press written after it is not overtaken by a re-import", async () => {
    const home = freshHome();
    writeFileSync(
      stateHomePaths({ home }).landingPressesJsonl,
      `${JSON.stringify(record({ atIso: "2026-09-09T12:00:00.000Z", headOid: HEAD_A }))}\n\n`,
    );
    const store = memoryPressStore();
    const presses = memoryPressJournalPort({ store });
    unwrap(await presses.readLatest({ home }));
    writeFileSync(
      stateHomePaths({ home }).landingPressesJsonl,
      `${JSON.stringify(record({ atIso: "2026-09-09T14:00:00.000Z", headOid: HEAD_B }))}\n`,
    );
    const latest = unwrap(await presses.readLatest({ home }));
    expect(store.importedRecords).toBe(1);
    expect(store.rows.map((row) => row.headOid)).toEqual([HEAD_A]);
    expect(pressFor({ number: 16378, presses: latest, repoSlug: "acme/widgets" })!.headOid).toBe(HEAD_A);
  });

  it("refuses an old file holding a line that is not a press, and imports nothing", async () => {
    const home = freshHome();
    writeFileSync(
      stateHomePaths({ home }).landingPressesJsonl,
      `${JSON.stringify(record({ atIso: "2026-09-09T12:00:00.000Z" }))}\nnot json\n`,
    );
    const store = memoryPressStore();
    const error = unwrapErr(await memoryPressJournalPort({ store }).readLatest({ home }));
    expect(error.code).toBe("PRESS_IMPORT_INVALID");
    expect(error.message).toContain("line 2: is not JSON");
    expect(store.imported).toBe(false);
    expect(store.rows).toEqual([]);
  });

  it("refuses an old file holding two disagreeing presses under one key, and imports nothing", async () => {
    const home = freshHome();
    const pressed = record({ atIso: "2026-09-09T12:00:00.000Z" });
    writeFileSync(
      stateHomePaths({ home }).landingPressesJsonl,
      `${JSON.stringify(pressed)}\n${JSON.stringify({ ...pressed, entryState: "" })}\n`,
    );
    const store = memoryPressStore();
    const error = unwrapErr(await memoryPressJournalPort({ store }).readLatest({ home }));
    expect(error.message).toBe(
      `the stored press ${pressKey({ record: pressed })} appears twice in the old file, disagreeing, so the press register cannot be read`,
    );
    expect(store.imported).toBe(false);
    expect(store.rows).toEqual([]);
  });

  it("imports an old file repeating one press identically as that one press", async () => {
    const home = freshHome();
    const line = JSON.stringify(record({ atIso: "2026-09-09T12:00:00.000Z" }));
    writeFileSync(stateHomePaths({ home }).landingPressesJsonl, `${line}\n${line}\n`);
    const store = memoryPressStore();
    unwrap(await memoryPressJournalPort({ store }).readLatest({ home }));
    expect(store.rows.map((row) => row.pressKey)).toEqual([
      pressKey({ record: record({ atIso: "2026-09-09T12:00:00.000Z" }) }),
    ]);
  });

  it("writes the press it checked, even when the caller's object changes while the append is in flight", async () => {
    const home = freshHome();
    const store = memoryPressStore();
    const mutable = { ...record({ atIso: "2026-09-09T12:00:00.000Z" }) };
    // The import runs after the append has checked the press and before it writes it: the window in question.
    const readImportFile: PressJournalSeams["readImportFile"] = () => {
      mutable.atIso = "not-a-date";
      return ok({ state: "absent" });
    };
    unwrap(await memoryPressJournalPort({ readImportFile, store }).append({ home, record: mutable }));
    expect(mutable.atIso).toBe("not-a-date");
    expect(store.rows.map((row) => row.atIso)).toEqual(["2026-09-09T12:00:00.000Z"]);
  });

  it("refuses an insert the store answers with a row other than the press it was sent", async () => {
    const home = freshHome();
    const store = memoryPressStore();
    store.imported = true;
    const real = memoryPressRows({ store });
    const altered: PressJournalRows = {
      ...real,
      insert: async (request) =>
        (await real.insert(request)).map((row) => (row === undefined ? row : { ...row, pressKey: "0".repeat(64) })),
    };
    const port = storePressJournalPort({
      seams: { connect: () => Promise.resolve(ok(altered)), readImportFile: () => ok({ state: "absent" }) },
    });
    const error = unwrapErr(await port.append({ home, record: record({ atIso: "2026-09-09T12:00:00.000Z" }) }));
    expect(error.message).toBe(
      `the stored press ${"0".repeat(64)} is stored under a key its own fields do not hash to, so the press register cannot be read`,
    );
  });

  it("refuses a collision whose read-back row sits under another key, rather than calling it the same press", async () => {
    const home = freshHome();
    const store = memoryPressStore();
    store.imported = true;
    const real = memoryPressRows({ store });
    const altered: PressJournalRows = {
      ...real,
      insert: () => Promise.resolve(ok(undefined)),
      readKey: ({ key }) =>
        Promise.resolve(ok({ ...record({ atIso: "2026-09-09T12:00:00.000Z" }), pressKey: `${key.slice(1)}0` })),
    };
    const port = storePressJournalPort({
      seams: { connect: () => Promise.resolve(ok(altered)), readImportFile: () => ok({ state: "absent" }) },
    });
    const error = unwrapErr(await port.append({ home, record: record({ atIso: "2026-09-09T12:00:00.000Z" }) }));
    expect(error.code).toBe("PRESS_RECORD_INVALID");
  });

  it("is idempotent on the same press, so a retried record after a lost acknowledgement succeeds", async () => {
    const home = freshHome();
    const store = memoryPressStore();
    const presses = memoryPressJournalPort({ store });
    const pressed = record({ atIso: "2026-09-09T12:00:00.000Z" });
    unwrap(await presses.append({ home, record: pressed }));
    expect(unwrap(await presses.append({ home, record: pressed }))).toBe(undefined);
    expect(store.rows.length).toBe(1);
  });

  it("refuses a different press under the same key rather than overwriting the first", async () => {
    const home = freshHome();
    const presses = memoryPressJournalPort();
    const pressed = record({ atIso: "2026-09-09T12:00:00.000Z" });
    unwrap(await presses.append({ home, record: pressed }));
    const error = unwrapErr(await presses.append({ home, record: { ...pressed, entryState: "" } }));
    expect(error.code).toBe("PRESS_KEY_CONFLICT");
  });

  it("refuses to read past a corrupt stored row rather than reading around it", async () => {
    const home = freshHome();
    const store = memoryPressStore();
    store.imported = true;
    store.rows.push({ ...record({ atIso: "2026-09-09T12:00:00.000Z" }), headOid: "", pressKey: "k-1" });
    const error = unwrapErr(await memoryPressJournalPort({ store }).readLatest({ home }));
    expect(error.code).toBe("PRESS_RECORD_INVALID");
    expect(error.message).toBe("the stored press k-1 carries no headOid, so the press register cannot be read");
  });

  it("refuses an empty read when the rows vanish between the marker probe and the read", async () => {
    const home = freshHome();
    const store = memoryPressStore();
    store.imported = true;
    store.importedRecords = 1;
    const pressed = record({ atIso: "2026-09-09T12:00:00.000Z" });
    store.rows.push({ ...pressed, pressKey: pressKey({ record: pressed }) });
    const real = memoryPressRows({ store });
    // The marker probe saw a row; a concurrent delete lands before the full-table read runs.
    const racing: PressJournalRows = {
      ...real,
      readAll: () => {
        store.rows.length = 0;
        return real.readAll();
      },
    };
    const port = storePressJournalPort({
      seams: { connect: () => Promise.resolve(ok(racing)), readImportFile: () => ok({ state: "absent" }) },
    });
    const error = unwrapErr(await port.readLatest({ home }));
    expect(error.code).toBe("PRESS_STORE_UNAVAILABLE");
    expect(error.message).toContain(
      "the marker says 1 record(s) were imported from the old file, and the table holds none",
    );
  });

  it("refuses a well-formed stored row whose key is not its own fields' key", async () => {
    const home = freshHome();
    const store = memoryPressStore();
    store.imported = true;
    store.rows.push({ ...record({ atIso: "2026-09-09T12:00:00.000Z" }), pressKey: "0".repeat(64) });
    const error = unwrapErr(await memoryPressJournalPort({ store }).readLatest({ home }));
    expect(error.code).toBe("PRESS_RECORD_INVALID");
    expect(error.message).toBe(
      `the stored press ${"0".repeat(64)} is stored under a key its own fields do not hash to, so the press register cannot be read`,
    );
  });

  it("refuses a press that would not decode before it opens the import", async () => {
    const store = memoryPressStore();
    const error = unwrapErr(
      await memoryPressJournalPort({ store }).append({ home: freshHome(), record: record({ atIso: "nope" }) }),
    );
    expect(error.code).toBe("PRESS_RECORD_INVALID");
    expect(store.imported).toBe(false);
  });

  it("closes every connection it opens", async () => {
    const home = freshHome();
    const store = memoryPressStore();
    const presses = memoryPressJournalPort({ store });
    unwrap(await presses.readLatest({ home }));
    unwrap(await presses.append({ home, record: record({ atIso: "2026-09-09T12:00:00.000Z" }) }));
    expect([store.opened, store.closed]).toEqual([2, 2]);
  });

  it("refuses with the store's outage, never an empty answer", async () => {
    const error = unwrapErr(await unavailablePressJournalPort().readLatest({ home: freshHome() }));
    expect(error.code).toBe("PRESS_STORE_UNAVAILABLE");
    expect(error.message).toContain("which pull requests were pressed is UNKNOWN");
  });
});
