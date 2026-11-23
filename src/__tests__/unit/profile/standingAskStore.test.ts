/**
 * `standingAskStore.ts`'s refusals and its transfer half, over the in-memory store (`../../standingAskFixture.ts`, a
 * seam, not a mock) with one row operation or journal read swapped per case: a marker read that fails or comes back
 * empty after the import wrote it, a journal that stops reading between the import and its witness check, a stored
 * read that refuses, an unselected home whose journal will not read, and the export's import and portable read.
 *
 * Per `testing.md`, every write goes to a `home` this file minted — never the ambient one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { StandingAskErrors } from "../../../profile/standingAskErrors.js";
import { readHomeFileStandingAsks } from "../../../profile/standingAskImport.js";
import type { StandingAskRows, StandingAskStoreSeams } from "../../../profile/standingAskPort.js";
import { storeStandingAskPort, storeStandingAskTransferPort } from "../../../profile/standingAskStore.js";
import type { StandingAsk } from "../../../profile/standingAsks.js";
import { scriptedStoreClient } from "../../scriptedStoreClient.js";
import { type StandingAskFake, standingAskFake } from "../../standingAskFixture.js";

const QUOTE = {
  anchor: "talk:a0000017-0000-4000-8000-000000000019",
  atIso: "2026-10-04T00:55:00.000Z",
  cut: "none",
  where: "console-voice",
  words: "chuck anything worth a look on the board",
} as const;

const ASK: StandingAsk = {
  covers: ["findings"],
  id: "a",
  quote: QUOTE,
  recordedAtIso: "2026-10-05T00:00:00.000Z",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-standing-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * The fake's seams with its rows' operations overridden.
 *
 * @param fake the in-memory store whose rows are the base
 * @param over the row operations this case swaps
 * @returns seams whose connection opens the swapped rows
 */
async function seamsWith({
  fake,
  over,
}: {
  fake: StandingAskFake;
  over: Partial<StandingAskRows>;
}): Promise<StandingAskStoreSeams> {
  const rows = unwrap(await fake.seams.connect({ home }));
  return { ...fake.seams, connect: async () => ok({ ...rows, ...over }) };
}

describe("storeStandingAskPort's refusals", () => {
  it("refuses a read whose marker source would not read after the import", async () => {
    const fake = standingAskFake();
    const seams = await seamsWith({
      fake,
      over: { markedSource: async () => err({ doing: "read the import marker's source", reason: "socket closed" }) },
    });
    const refused = unwrapErr(await storeStandingAskPort({ seams }).readActive({ home }));
    expect(refused.code).toBe("STANDING_ASK_STORE_UNAVAILABLE");
    expect(refused.message).toBe("the store could not read the import marker's source: socket closed");
  });

  it("refuses a read whose marker is gone after the import wrote it", async () => {
    const fake = standingAskFake();
    const seams = await seamsWith({ fake, over: { markedSource: async () => ok(undefined) } });
    const refused = unwrapErr(await storeStandingAskPort({ seams }).readActive({ home }));
    expect(refused.message).toBe(
      "the store could not read the standing-ask import marker: the marker the import wrote is gone",
    );
    expect(fake.state.marker).toEqual({ records: 0, source: { state: "absent" } });
  });

  it("refuses a read whose journal stops reading between the import and its witness check", async () => {
    let reads = 0;
    const fake = standingAskFake({
      readHomeFile: (request) => {
        reads += 1;
        if (reads === 1) {
          return readHomeFileStandingAsks(request);
        }
        return err(StandingAskErrors.homeFileUnreadable({ path: "standing-asks.jsonl", reason: "torn read" }));
      },
    });
    const refused = unwrapErr(await fake.port.readActive({ home }));
    expect(refused.code).toBe("STANDING_ASK_HOME_FILE_UNREADABLE");
    expect(refused.message).toBe("the standing-ask journal standing-asks.jsonl would not read: torn read");
    expect(reads).toBe(2);
  });

  it("refuses a read whose stored rows do not read as one register", async () => {
    const fake = standingAskFake();
    const seams = await seamsWith({
      fake,
      over: { readStored: async () => err(StandingAskErrors.rowUnreadable({ why: "two active generations of a" })) },
    });
    const refused = unwrapErr(await storeStandingAskPort({ seams }).readActive({ home }));
    expect(refused.message).toBe("the stored standing asks do not read as one register: two active generations of a");
  });

  it("refuses an unselected read whose journal will not read, rather than reading nothing recorded", async () => {
    const fake = standingAskFake({
      connection: "unselected",
      readHomeFile: () => err(StandingAskErrors.homeFileUnreadable({ path: "standing-asks.jsonl", reason: "EACCES" })),
    });
    const refused = unwrapErr(await fake.port.readActive({ home }));
    expect(refused.message).toBe("the standing-ask journal standing-asks.jsonl would not read: EACCES");
  });
});

describe("storeStandingAskTransferPort", () => {
  it("imports an absent journal over the export's client, then hands back every line and the asks it folds to", async () => {
    const fake = standingAskFake();
    const rows = unwrap(await fake.seams.connect({ home }));
    const { client } = scriptedStoreClient({ answer: () => [] });
    const port = storeStandingAskTransferPort({
      seams: { readHomeFile: fake.seams.readHomeFile, readSnapshot: () => rows.readStored(), rowsOver: () => rows },
    });
    expect(unwrap(await port.ensureImported({ client, home }))).toBe(undefined);
    expect(fake.state.marker).toEqual({ records: 0, source: { state: "absent" } });
    unwrap(await fake.port.write({ home, request: { ask: ASK, kind: "add" } }));
    const journal = unwrap(await port.readPortableJournal({ reader: client }));
    expect(journal.active.map((one) => one.id)).toEqual(["a"]);
    expect(journal.lines.length).toBe(1);
    expect(journal.lines[0]).toContain('"id":"a"');
  });

  it("refuses a portable read whose snapshot refuses, handing back no line", async () => {
    const fake = standingAskFake();
    const { client } = scriptedStoreClient({ answer: () => [] });
    const port = storeStandingAskTransferPort({
      seams: {
        readHomeFile: fake.seams.readHomeFile,
        readSnapshot: async () =>
          err(StandingAskErrors.storeUnavailable({ doing: "open the snapshot", reason: "gone" })),
        rowsOver: () => {
          throw new Error("the portable read must not open rows of its own");
        },
      },
    });
    const refused = unwrapErr(await port.readPortableJournal({ reader: client }));
    expect(refused.message).toBe("the store could not open the snapshot: gone");
  });
});
