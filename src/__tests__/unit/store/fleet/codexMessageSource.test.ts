/**
 * Reading the owner's interactive Codex messages out of real SQLite files built in a temp Codex home: only `cli` and `vscode`
 * threads, only their `userMessage` items, and an exec thread's text never read at all.
 */
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { importSqliteQuietly } from "../../../../lib/sqlite.js";
import { CODEX_HISTORY_FILE, CODEX_STATE_FILE, readCodexMessages } from "../../../../store/fleet/codexMessageSource.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";

let codexHome: string;

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
});

afterEach(() => {
  rmSync(codexHome, { force: true, recursive: true });
});

/** A `userMessage` item's JSON. */
function said({ text }: { text: string }): string {
  return JSON.stringify({ content: [{ text, type: "text" }], type: "userMessage" });
}

/**
 * Write both Codex files: three threads — one per surface — and items in each.
 *
 * @param cwd the cli thread's working directory; a number writes a row of the wrong shape
 */
async function writeCodexHome({ cwd = "/work/acme" }: { cwd?: string | number } = {}): Promise<void> {
  const sqlite = await importSqliteQuietly();
  const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
  state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
  const thread = state.prepare("insert into threads values (?, ?, ?, ?)");
  thread.run("th-cli", "cli", "user", cwd);
  thread.run("th-vscode", "vscode", null, "/work/site");
  thread.run("th-exec", "exec", null, "/work/fleet");
  state.close();
  const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
  history.exec(
    "create table thread_items (thread_id text, turn_id text, item_id text, item_type text, created_at_ms integer, " +
      "rollout_ordinal integer, item_json text)",
  );
  const item = history.prepare("insert into thread_items values (?, ?, ?, ?, ?, ?, ?)");
  item.run("th-cli", "t1", "i1", "userMessage", 2_000, 1, said({ text: "second" }));
  item.run("th-cli", "t1", "i2", "agentMessage", 2_500, 2, said({ text: "the agent's reply" }));
  item.run("th-vscode", "t1", "i1", "userMessage", 1_000, 1, said({ text: "first" }));
  item.run("th-exec", "t1", "i1", "userMessage", 1_500, 1, said({ text: "a fleet pass prompt" }));
  history.close();
}

describe("readCodexMessages", () => {
  it("reads only interactive threads' userMessage items, oldest first", async () => {
    await writeCodexHome();

    const read = unwrap(await readCodexMessages({ codexHome }));

    expect(read).toEqual({
      historyPath: join(codexHome, CODEX_HISTORY_FILE),
      kind: "read",
      messages: [
        { createdAtMs: 1_000, itemId: "i1", itemJson: said({ text: "first" }), threadId: "th-vscode", turnId: "t1" },
        { createdAtMs: 2_000, itemId: "i1", itemJson: said({ text: "second" }), threadId: "th-cli", turnId: "t1" },
      ],
      refused: [],
      threads: new Map([
        ["th-cli", { cwd: "/work/acme", id: "th-cli", surface: "cli", threadSource: "user" }],
        ["th-vscode", { cwd: "/work/site", id: "th-vscode", surface: "vscode", threadSource: null }],
      ]),
    });
  });

  it("refuses a thread_items that is a view, whose created_at_ms the import's own clock would compute", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("th", "cli", "user", "/work/acme");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec(
      "create view THREAD_ITEMS as select 'th' as thread_id, 't' as turn_id, 'i' as item_id, " +
        "'userMessage' as item_type, cast(strftime('%s','now') as integer) * 1000 as created_at_ms, " +
        `1 as rollout_ordinal, '${said({ text: "hi" })}' as item_json`,
    );
    history.close();

    const refusal = unwrapErr(await readCodexMessages({ codexHome }));

    expect(refusal).toEqual(
      FleetImportErrors.unstorableOwnerCapture({
        path: join(codexHome, CODEX_HISTORY_FILE),
        reason: "its thread_items is not a stored table, so what it answers may not be what Codex wrote",
      }),
    );
  });

  it("refuses a thread_items that is a virtual table, which sqlite_schema still calls a table", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("th", "cli", "user", "/work/acme");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec(
      "create virtual table thread_items using fts5(thread_id, turn_id, item_id, item_type, " +
        "created_at_ms unindexed, rollout_ordinal unindexed, item_json unindexed)",
    );
    history.close();

    const refusal = unwrapErr(await readCodexMessages({ codexHome }));

    expect(refusal).toEqual(
      FleetImportErrors.unstorableOwnerCapture({
        path: join(codexHome, CODEX_HISTORY_FILE),
        reason: "its thread_items is not a stored table, so what it answers may not be what Codex wrote",
      }),
    );
  });

  it("refuses a threads that is a view rather than reading the sources it computes", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create view threads as select 'th' as id, 'cli' as source, 'user' as thread_source, '/w' as cwd");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec("create table thread_items (thread_id text)");
    history.close();

    const refusal = unwrapErr(await readCodexMessages({ codexHome }));

    expect(refusal).toEqual(
      FleetImportErrors.unstorableOwnerCapture({
        path: join(codexHome, CODEX_STATE_FILE),
        reason: "its threads is not a stored table, so what it answers may not be what Codex wrote",
      }),
    );
  });

  it("names a thread row of the wrong shape rather than skipping it quietly", async () => {
    await writeCodexHome({ cwd: 7 });

    const read = unwrap(await readCodexMessages({ codexHome }));

    expect(read).toEqual(
      expect.objectContaining({
        refused: [
          expect.objectContaining({
            code: "UNSTORABLE_OWNER_CAPTURE",
            path: `${join(codexHome, CODEX_STATE_FILE)}#th-cli`,
          }),
        ],
      }),
    );
  });

  it("never reads an exec thread whose id differs only in case, even under a NOCASE history column", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("abc", "cli", "user", "/work/acme");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("ABC", "exec", null, "/work/fleet");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec(
      "create table thread_items (thread_id text collate nocase, turn_id text, item_id text, " +
        "item_type text collate nocase, created_at_ms integer, rollout_ordinal integer, item_json text)",
    );
    const item = history.prepare("insert into thread_items values (?, ?, ?, ?, ?, ?, ?)");
    item.run("abc", "t1", "i1", "userMessage", 1_000, 1, said({ text: "mine" }));
    item.run("ABC", "t1", "i1", "userMessage", 1_500, 1, said({ text: "a fleet pass prompt" }));
    history.close();

    const read = unwrap(await readCodexMessages({ codexHome }));

    expect(read).toEqual(
      expect.objectContaining({
        messages: [
          { createdAtMs: 1_000, itemId: "i1", itemJson: said({ text: "mine" }), threadId: "abc", turnId: "t1" },
        ],
      }),
    );
  });

  it("never reads an exec thread whose id a numeric history column coerces to equal an interactive one", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("01", "cli", "user", "/work/acme");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("1", "exec", null, "/work/fleet");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec(
      "create table thread_items (thread_id integer, turn_id text, item_id text, item_type text, " +
        "created_at_ms integer, rollout_ordinal integer, item_json text)",
    );
    history
      .prepare("insert into thread_items values (?, ?, ?, ?, ?, ?, ?)")
      .run("1", "t1", "i1", "userMessage", 1_500, 1, said({ text: "a fleet pass prompt" }));
    history.close();

    // The witness is `refused`: had the exec row been selected, its numeric id would be refused here, its text read.
    expect(unwrap(await readCodexMessages({ codexHome }))).toEqual(
      expect.objectContaining({ messages: [], refused: [] }),
    );
  });

  it("reads nothing under an id an exec row shares with a cli row, in a damaged state file with no primary key", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create table threads (id text, source text, thread_source text, cwd)");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("dup", "cli", "user", "/work/acme");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("dup", "exec", null, "/work/fleet");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec(
      "create table thread_items (thread_id text, turn_id text, item_id text, item_type text, " +
        "created_at_ms integer, rollout_ordinal integer, item_json text)",
    );
    history
      .prepare("insert into thread_items values (?, ?, ?, ?, ?, ?, ?)")
      .run("dup", "t1", "i1", "userMessage", 1_500, 1, said({ text: "a fleet pass prompt" }));
    history.close();

    expect(unwrap(await readCodexMessages({ codexHome }))).toEqual(
      expect.objectContaining({ messages: [], threads: new Map() }),
    );
  });

  it("refuses an id two interactive rows share in a damaged state file, reading none of its messages", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create table threads (id text, source text, thread_source text, cwd)");
    const thread = state.prepare("insert into threads values (?, ?, ?, ?)");
    thread.run("dup", "cli", "user", "/work/a");
    thread.run("dup", "vscode", "voice_chat", "/work/b");
    thread.run("dup", "cli", null, "/work/c");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec(
      "create table thread_items (thread_id text, turn_id text, item_id text, item_type text, " +
        "created_at_ms integer, rollout_ordinal integer, item_json text)",
    );
    history
      .prepare("insert into thread_items values (?, ?, ?, ?, ?, ?, ?)")
      .run("dup", "t1", "i1", "userMessage", 1_500, 1, said({ text: "mine" }));
    history.close();

    expect(unwrap(await readCodexMessages({ codexHome }))).toEqual(
      expect.objectContaining({
        messages: [],
        refused: [
          expect.objectContaining({
            path: `${join(codexHome, CODEX_STATE_FILE)}#dup`,
            reason: "its threads table holds this id more than once",
          }),
        ],
        threads: new Map(),
      }),
    );
  });

  it("refuses a message whose item_json or item id is not valid UTF-8, rather than storing U+FFFD as the owner's words", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("th-cli", "cli", "user", "/work/acme");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec(
      "create table thread_items (thread_id text, turn_id text, item_id text, item_type text, " +
        "created_at_ms integer, rollout_ordinal integer, item_json text)",
    );
    const [before, after] = said({ text: "\u0000" }).split("\\u0000");
    const lossyJsonHex = Buffer.concat([Buffer.from(before!), Buffer.from([0x80]), Buffer.from(after!)]).toString(
      "hex",
    );
    history.exec(
      `insert into thread_items values ('th-cli', 't1', 'i1', 'userMessage', 1000, 1, cast(x'${lossyJsonHex}' as text))`,
    );
    history.exec(
      "insert into thread_items values ('th-cli', 't2', cast(x'80' as text), 'userMessage', 2000, 1, " +
        `'${said({ text: "bad id" })}')`,
    );
    history.exec(
      "insert into thread_items values ('th-cli', cast(x'80' as text), 'i4', 'userMessage', 4000, 1, " +
        `'${said({ text: "bad turn" })}')`,
    );
    history
      .prepare("insert into thread_items values (?, ?, ?, ?, ?, ?, ?)")
      .run("th-cli", "t3", "i3", "userMessage", 3_000, 1, said({ text: "mine" }));
    history.close();

    const read = unwrap(await readCodexMessages({ codexHome }));
    const historyPath = join(codexHome, CODEX_HISTORY_FILE);

    expect(read).toEqual(
      expect.objectContaining({
        messages: [
          { createdAtMs: 3_000, itemId: "i3", itemJson: said({ text: "mine" }), threadId: "th-cli", turnId: "t3" },
        ],
        refused: [
          expect.objectContaining({ code: "UNSTORABLE_OWNER_CAPTURE", path: `${historyPath}#th-cli/t1/i1` }),
          expect.objectContaining({ code: "UNSTORABLE_OWNER_CAPTURE", path: `${historyPath}#th-cli/t2/�` }),
          expect.objectContaining({ code: "UNSTORABLE_OWNER_CAPTURE", path: `${historyPath}#th-cli/�/i4` }),
        ],
      }),
    );
  });

  it("refuses a thread whose cwd is not valid UTF-8, since every capture of it would store the lossy text", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
    state.exec("insert into threads values ('th-cli', 'cli', 'user', cast(x'2f80' as text))");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec(
      "create table thread_items (thread_id text, turn_id text, item_id text, item_type text, " +
        "created_at_ms integer, rollout_ordinal integer, item_json text)",
    );
    history.close();

    expect(unwrap(await readCodexMessages({ codexHome }))).toEqual(
      expect.objectContaining({
        refused: [expect.objectContaining({ path: `${join(codexHome, CODEX_STATE_FILE)}#th-cli` })],
        threads: new Map(),
      }),
    );
  });

  it("refuses a cli thread id that is not valid UTF-8, so its lossy decode cannot equal an exec thread's id", async () => {
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(join(codexHome, CODEX_STATE_FILE));
    state.exec("create table threads (id text primary key, source text, thread_source text, cwd)");
    state.exec("insert into threads values (cast(x'80' as text), 'cli', 'user', '/work/acme')");
    state.prepare("insert into threads values (?, ?, ?, ?)").run("�", "exec", null, "/work/fleet");
    state.close();
    const history = new sqlite.DatabaseSync(join(codexHome, CODEX_HISTORY_FILE));
    history.exec(
      "create table thread_items (thread_id text, turn_id text, item_id text, item_type text, " +
        "created_at_ms integer, rollout_ordinal integer, item_json text)",
    );
    history
      .prepare("insert into thread_items values (?, ?, ?, ?, ?, ?, ?)")
      .run("�", "t1", "i1", "userMessage", 1_500, 1, said({ text: "a fleet pass prompt" }));
    history.close();

    expect(unwrap(await readCodexMessages({ codexHome }))).toEqual(
      expect.objectContaining({
        messages: [],
        refused: [expect.objectContaining({ path: `${join(codexHome, CODEX_STATE_FILE)}#�` })],
      }),
    );
  });

  it("reports a Codex home with no state file as an absent source, naming the file", async () => {
    expect(unwrap(await readCodexMessages({ codexHome }))).toEqual({
      kind: "absent",
      path: join(codexHome, CODEX_STATE_FILE),
    });
  });

  it("refuses a Codex home it cannot search, rather than reporting its databases absent", async () => {
    await writeCodexHome();
    chmodSync(codexHome, 0o000);
    try {
      const refusal = unwrapErr(await readCodexMessages({ codexHome }));

      expect(refusal.code).toBe("UNSTORABLE_OWNER_CAPTURE");
      expect(refusal.message).toContain("EACCES");
    } finally {
      chmodSync(codexHome, 0o700);
    }
  });
});
