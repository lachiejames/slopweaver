/**
 * The cmux event state's row operations over a store that cannot run a statement: Drizzle's connectionless
 * `drizzle.mock()` database builds every statement for real and then throws when asked to execute it, which is
 * exactly a driver failure. So what is under test is the refusal half — every operation answers
 * `CMUX_EVENT_STORE_UNAVAILABLE` naming what it was doing, never a thrown error and never an empty row — the
 * import read's absent-versus-unreadable split, and that `close` is the client's own. What only a real database can
 * prove is `src/__tests__/integration/cmuxEventStateStore.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { afterEach, describe, expect, it } from "vitest";

import { cmuxEventStateRowsOver, readCmuxEventImportText } from "../../../../cmux/eventState/storeRows.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { StoreClient } from "../../../../store/client.js";
import * as storeSchema from "../../../../store/schema.js";

/**
 * A client whose database builds statements but cannot run one, and which counts its own closes.
 *
 * @returns the client, and how many times it has been closed so far
 */
function unrunnableClient(): { client: StoreClient; closes: () => number } {
  let closed = 0;
  const client: StoreClient = {
    close: async () => {
      closed += 1;
    },
    db: drizzle.mock({ schema: storeSchema }),
  };
  return { client, closes: () => closed };
}

const WRITE = {
  activities: {},
  consumer: "session-watch",
  cursorSeq: 12,
  recordedAtIso: "2026-10-31T04:00:00.000Z",
} as const;

describe("the cmux event state's row operations over a store that cannot run a statement", () => {
  it("refuses a read as CMUX_EVENT_STORE_UNAVAILABLE, naming the consumer read", async () => {
    const rows = cmuxEventStateRowsOver({ client: unrunnableClient().client });

    const error = unwrapErr(await rows.read({ consumer: "cmux-events" }));

    expect(error.code).toBe("CMUX_EVENT_STORE_UNAVAILABLE");
    expect(error.message).toContain("the store could not read the cmux-events state");
  });

  it("refuses the importing insert the same way, naming the insert", async () => {
    const rows = cmuxEventStateRowsOver({ client: unrunnableClient().client });

    const error = unwrapErr(await rows.insert(WRITE));

    expect(error.code).toBe("CMUX_EVENT_STORE_UNAVAILABLE");
    expect(error.message).toContain("the store could not insert the session-watch state");
  });

  it("refuses a compare-and-set update the same way, naming the write", async () => {
    const rows = cmuxEventStateRowsOver({ client: unrunnableClient().client });

    const error = unwrapErr(await rows.update({ ...WRITE, expectedRevision: 3 }));

    expect(error.code).toBe("CMUX_EVENT_STORE_UNAVAILABLE");
    expect(error.message).toContain("the store could not write the session-watch state");
  });

  it("closes through the client it was given", async () => {
    const { client, closes } = unrunnableClient();
    const rows = cmuxEventStateRowsOver({ client });

    await rows.close();

    expect(closes()).toBe(1);
  });
});

describe("readCmuxEventImportText", () => {
  const dirs: string[] = [];
  const freshDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "cmux-import-"));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("answers undefined for a file that is not there", () => {
    expect(unwrap(readCmuxEventImportText({ path: join(freshDir(), "cmux-event-cursor.json") }))).toBeUndefined();
  });

  it("answers the text of a file that is", () => {
    const path = join(freshDir(), "cmux-event-cursor.json");
    writeFileSync(path, '{"seq":7}');

    expect(unwrap(readCmuxEventImportText({ path }))).toBe('{"seq":7}');
  });

  it("refuses a path that is there and cannot be read as a file, naming it", () => {
    const path = join(freshDir(), "cmux-event-cursor.json");
    mkdirSync(path);

    const error = unwrapErr(readCmuxEventImportText({ path }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_UNREADABLE");
    expect(error.path).toBe(path);
  });
});
