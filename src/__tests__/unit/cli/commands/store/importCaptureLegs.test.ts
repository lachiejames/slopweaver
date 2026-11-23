/**
 * The two captured-turn legs over a temp folder: a dictations folder is projected recording by recording with every
 * skip counted, a source this home did not resolve is a named note, never a read, and a leg that refused any record
 * hands its writer nothing at all.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok } from "#lib/result.js";
import { importSqliteQuietly } from "#lib/sqlite.js";
import {
  type CaptureWriter,
  heldBackNote,
  runCodexMessagesLeg,
  runDictationsLeg,
} from "../../../../../cli/commands/store/importCaptureLegs.js";
import { newTally } from "../../../../../cli/commands/store/importFleetCore.js";
import { sourceNotResolvedNote } from "../../../../../store/fleet/captureSources.js";
import { CODEX_HISTORY_FILE, CODEX_STATE_FILE } from "../../../../../store/fleet/codexMessageSource.js";
import { FleetImportErrors } from "../../../../../store/fleet/errors.js";
import type { NewOwnerCaptureRecord } from "../../../../../store/schema/ownerCapture.js";

/** The recording's start as epoch seconds, the way Superwhisper names the folder. */
const FOLDER = String(Date.UTC(2026, 5, 3, 2, 6, 31) / 1000);

let recordings: string;

beforeEach(() => {
  recordings = mkdtempSync(join(tmpdir(), "dictations-leg-"));
});

afterEach(() => {
  rmSync(recordings, { force: true, recursive: true });
});

/** Write one recording folder's `meta.json`. */
function recording({
  folder,
  result,
  datetime = "2026-06-03T02:06:31",
}: {
  folder: string;
  result: string;
  datetime?: string;
}): void {
  mkdirSync(join(recordings, folder));
  writeFileSync(join(recordings, folder, "meta.json"), JSON.stringify({ datetime, duration: 4210, result }));
}

/** A plain fake writer that keeps every batch it is handed and reports each row as new. */
function recordingWriter(): { write: CaptureWriter; batches: (readonly NewOwnerCaptureRecord[])[] } {
  const batches: (readonly NewOwnerCaptureRecord[])[] = [];
  const write: CaptureWriter = ({ rows }) => {
    batches.push(rows);
    return Promise.resolve(ok(rows.length));
  };
  return { batches, write };
}

describe("runDictationsLeg", () => {
  it("projects each recording and counts the silent one and the one still being written", async () => {
    recording({ folder: FOLDER, result: "Merge it." });
    recording({ folder: String(Number(FOLDER) + 1), result: "" });
    mkdirSync(join(recordings, String(Number(FOLDER) + 2)));
    writeFileSync(join(recordings, ".DS_Store"), "");

    const outcome = await runDictationsLeg({ recordings, write: undefined });

    expect(outcome.projected).toBe(1);
    expect(outcome.written).toBe(0);
    expect(outcome.refused).toEqual([]);
    expect(outcome.notes).toEqual([
      "1 recording(s) with no speech skipped",
      "1 recording folder(s) with no meta.json yet (a recording still being written) skipped",
      "1 plain file(s) beside the recording folders skipped",
    ]);
  });

  it("hands the writer every projected row when nothing was refused", async () => {
    recording({ folder: FOLDER, result: "Merge it." });
    recording({ datetime: "2026-06-03T02:06:32", folder: String(Number(FOLDER) + 1), result: "Ship it." });
    const { batches, write } = recordingWriter();

    const outcome = await runDictationsLeg({ recordings, write });

    expect(batches.map((rows) => rows.length)).toEqual([2]);
    expect(outcome.written).toBe(2);
    expect(outcome.refused).toEqual([]);
  });

  it("writes nothing at all when one recording is refused beside a valid one", async () => {
    recording({ folder: FOLDER, result: "Merge it." });
    const broken = String(Number(FOLDER) + 1);
    mkdirSync(join(recordings, broken));
    writeFileSync(join(recordings, broken, "meta.json"), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
    const { batches, write } = recordingWriter();

    const outcome = await runDictationsLeg({ recordings, write });

    expect(batches).toEqual([]);
    expect(outcome.projected).toBe(1);
    expect(outcome.written).toBe(0);
    expect(outcome.refused).toEqual([expect.objectContaining({ path: join(recordings, broken, "meta.json") })]);
    expect(outcome.notes![3]).toBe("nothing written — 1 record(s) refused; repair them, then import again");
  });

  it("reads a recording through a symlink, and refuses a link to something that is no folder", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "dictations-linked-"));
    try {
      mkdirSync(join(elsewhere, "real"));
      writeFileSync(
        join(elsewhere, "real", "meta.json"),
        JSON.stringify({ datetime: "2026-06-03T02:06:31", duration: 4210, result: "Merge it." }),
      );
      writeFileSync(join(elsewhere, "a-file"), "");
      symlinkSync(join(elsewhere, "real"), join(recordings, FOLDER));
      symlinkSync(join(elsewhere, "a-file"), join(recordings, String(Number(FOLDER) + 1)));

      const outcome = await runDictationsLeg({ recordings, write: undefined });

      expect(outcome.projected).toBe(1);
      expect(outcome.refused).toEqual([
        expect.objectContaining({
          code: "UNSTORABLE_OWNER_CAPTURE",
          path: join(recordings, String(Number(FOLDER) + 1), "meta.json"),
        }),
      ]);
    } finally {
      rmSync(elsewhere, { force: true, recursive: true });
    }
  });

  it("names a folder that is not there as an absent source", async () => {
    const absent = join(recordings, "absent");

    expect((await runDictationsLeg({ recordings: absent, write: undefined })).absentSource).toBe(absent);
  });

  it("names a dictations path that will not list as a refusal, rather than rejecting", async () => {
    const notAFolder = join(recordings, "a-file");
    writeFileSync(notAFolder, "");

    const outcome = await runDictationsLeg({ recordings: notAFolder, write: undefined });

    expect(outcome.refused).toEqual([expect.objectContaining({ code: "UNSTORABLE_OWNER_CAPTURE", path: notAFolder })]);
  });

  it("refuses a recording whose meta.json it cannot reach, rather than counting it as still being written", async () => {
    recording({ folder: FOLDER, result: "Merge it." });
    const locked = join(recordings, FOLDER);
    chmodSync(locked, 0o000);
    try {
      const outcome = await runDictationsLeg({ recordings, write: undefined });

      expect(outcome.projected).toBe(0);
      expect(outcome.refused).toEqual([
        expect.objectContaining({ code: "UNSTORABLE_OWNER_CAPTURE", path: join(locked, "meta.json") }),
      ]);
      expect(outcome.notes![1]).toBe(
        "0 recording folder(s) with no meta.json yet (a recording still being written) skipped",
      );
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it("reads nothing when this home resolved no folder, and says which flag would name one", async () => {
    expect((await runDictationsLeg({ recordings: undefined, write: undefined })).notes).toEqual([
      sourceNotResolvedNote({ flag: "--dictations" }),
    ]);
  });
});

describe("heldBackNote", () => {
  const row = { source: "dictation" } as unknown as NewOwnerCaptureRecord;

  it("holds every row back once the tally carries a refusal", () => {
    const tally = newTally();
    tally.refused.push(FleetImportErrors.unstorableOwnerCapture({ path: "/x/meta.json", reason: "bad bytes" }));

    expect(heldBackNote({ rows: [row, row], tally })).toBe(
      "nothing written — 1 record(s) refused; repair them, then import again",
    );
  });

  it("holds nothing back when the tally is clean", () => {
    expect(heldBackNote({ rows: [row], tally: newTally() })).toBe(undefined);
  });

  it("says nothing when a refusal left no row to hold", () => {
    const tally = newTally();
    tally.refused.push(FleetImportErrors.unstorableOwnerCapture({ path: "/x", reason: "will not list" }));

    expect(heldBackNote({ rows: [], tally })).toBe(undefined);
  });
});

describe("runCodexMessagesLeg", () => {
  it("reads nothing when this home resolved no Codex home, and says which flag would name one", async () => {
    expect((await runCodexMessagesLeg({ codexHome: undefined, write: undefined })).notes).toEqual([
      sourceNotResolvedNote({ flag: "--codex-home" }),
    ]);
  });

  it("keeps two same-text messages whose raw ids slash-join to one string as two rows, each at its own instant", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(recordings, CODEX_STATE_FILE));
    state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("a/b", "cli", "user", "/work/acme");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("a", "cli", "user", "/work/acme");
    state.close();
    const history = new sqlite.DatabaseSync(join(recordings, CODEX_HISTORY_FILE));
    history.exec(
      "create table thread_items (thread_id text, turn_id text, item_id text, item_type text, " +
        "created_at_ms integer, rollout_ordinal integer, item_json text)",
    );
    const item = history.prepare("insert into thread_items values (?, ?, ?, ?, ?, ?, ?)");
    const said = ({ text }: { text: string }): string =>
      JSON.stringify({ content: [{ text, type: "text" }], type: "userMessage" });
    // The same text, so a key collision would pass the drift check and the conflict-do-nothing insert would drop one.
    item.run("a/b", "c", "d", "userMessage", 1_000, 1, said({ text: "SAME" }));
    item.run("a", "b/c", "d", "userMessage", 2_000, 1, said({ text: "SAME" }));
    history.close();
    const { batches, write } = recordingWriter();

    const outcome = await runCodexMessagesLeg({ codexHome: recordings, write });

    expect(outcome.refused).toEqual([]);
    expect(
      batches
        .flat()
        .toSorted((a, b) => a.saidAt.getTime() - b.saidAt.getTime())
        .map((row) => [row.sourceId, row.saidAt.toISOString()]),
    ).toEqual([
      ["a%2Fb/c/d", "1970-01-01T00:00:01.000Z"],
      ["a/b%2Fc/d", "1970-01-01T00:00:02.000Z"],
    ]);
  });

  it("refuses one id triple held twice with the same text at two instants, and writes neither", async () => {
    // Codex's own table keys on the triple; this fixture omits that key to stand for a history that broke it.
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(recordings, CODEX_STATE_FILE));
    state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("th", "cli", "user", "/work/acme");
    state.close();
    const history = new sqlite.DatabaseSync(join(recordings, CODEX_HISTORY_FILE));
    history.exec(
      "create table thread_items (thread_id text, turn_id text, item_id text, item_type text, " +
        "created_at_ms integer, rollout_ordinal integer, item_json text)",
    );
    const item = history.prepare("insert into thread_items values (?, ?, ?, ?, ?, ?, ?)");
    const said = JSON.stringify({ content: [{ text: "SAME", type: "text" }], type: "userMessage" });
    item.run("th", "t", "i", "userMessage", 1_000, 1, said);
    item.run("th", "t", "i", "userMessage", 2_000, 2, said);
    history.close();
    const { batches, write } = recordingWriter();

    const outcome = await runCodexMessagesLeg({ codexHome: recordings, write });

    expect(batches).toEqual([]);
    expect(outcome.refused).toEqual([
      expect.objectContaining({
        code: "UNSTORABLE_OWNER_CAPTURE",
        path: `${join(recordings, CODEX_HISTORY_FILE)}#th/t/i`,
        reason: "another record of this source builds the same id with a different body, instant or recorded field",
      }),
    ]);
  });

  it("names a Codex home with no databases as an absent source", async () => {
    const outcome = await runCodexMessagesLeg({ codexHome: recordings, write: undefined });

    expect(outcome.absentSource).toContain(recordings);
    expect(outcome.projected).toBe(0);
  });
});
