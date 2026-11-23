/**
 * The store-backed cmux event state, over an in-memory row and the real import files under a throwaway home: the
 * row is the authority, the two files are imported once and together, a write is compare-and-set and never
 * retried, and a store that cannot be reached is a refusal rather than a file.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withoutCredentials } from "../../../../cmux/eventState/errors.js";
import { type CmuxEventStateRows, storeCmuxEventStatePort } from "../../../../cmux/eventState/storePort.js";
import type { SessionActivity } from "../../../../cmux/sessionActivity.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import {
  memoryCmuxEventStatePort,
  memoryCmuxEventStateSeams,
  memoryCmuxEventStateStore,
} from "../../../cmuxEventStateFixture.js";

const NOW = "2026-10-31T04:00:00.000Z";

const homes: string[] = [];

/**
 * A fresh, empty Slopweaver home.
 *
 * @returns its path
 */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "cmux-state-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/**
 * One activity, folded up to `lastSeq`.
 *
 * @param workspaceId the workspace it is for
 * @param lastSeq the last sequence folded into it
 * @returns the activity
 */
function activity({ workspaceId, lastSeq }: { workspaceId: string; lastSeq: number }): SessionActivity {
  return {
    agentSessionId: undefined,
    agentSource: undefined,
    attentionKind: "question",
    attentionSinceIso: "2026-10-31T03:00:00.000Z",
    cwd: undefined,
    lastEventAtIso: "2026-10-31T03:00:00.000Z",
    lastEventName: "agent.hook.AskUserQuestion",
    lastSeq,
    lastTurnEndedAtIso: undefined,
    lastTurnStartedAtIso: undefined,
    sessionStartedAtIso: undefined,
    toolCalls: 2,
    workspaceId,
  };
}

/** Write the retired cursor file into a home. */
function seedCursorFile({ home, text }: { home: string; text: string }): void {
  writeFileSync(stateHomePaths({ home }).cmuxEventCursorJson, text);
}

/** Write the retired activity file into a home. */
function seedFoldFile({ home, text }: { home: string; text: string }): void {
  writeFileSync(stateHomePaths({ home }).cmuxSessionActivityJson, text);
}

const W1 = activity({ lastSeq: 38, workspaceId: "W1" });
const FOLD_FILE = JSON.stringify({ activities: { W1 }, recordedAtIso: NOW });
const CURSOR_FILE = JSON.stringify({ recordedAtIso: NOW, seq: 40 });

describe("session watch's state: the one-time import", () => {
  it("reads nothing folded, and inserts nothing, on a home with neither file", async () => {
    const store = memoryCmuxEventStateStore();

    const state = unwrap(await memoryCmuxEventStatePort({ store }).readSessionWatch({ home: freshHome() }));

    expect(state).toEqual({ activities: {}, cursorSeq: undefined, revision: null });
    expect(store.rows.size).toBe(0);
  });

  it("imports the pair into one row at revision 1, at the fold's own high-water mark, and the row wins every later read", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });
    seedFoldFile({ home, text: FOLD_FILE });
    const store = memoryCmuxEventStateStore();
    const port = memoryCmuxEventStatePort({ store });

    const first = unwrap(await port.readSessionWatch({ home }));
    seedCursorFile({ home, text: JSON.stringify({ seq: 999 }) });
    const second = unwrap(await port.readSessionWatch({ home }));

    expect(first).toEqual({ activities: { W1 }, cursorSeq: 38, revision: 1 });
    expect(second).toEqual(first);
    expect(store.rows.get("session-watch")!.cursorSeq).toBe(38);
  });

  it("resumes after the last event the fold applied, not where the old cmux events pushed the shared cursor", async () => {
    const home = freshHome();
    const W2 = activity({ lastSeq: 50, workspaceId: "W2" });
    seedCursorFile({ home, text: JSON.stringify({ recordedAtIso: NOW, seq: 100 }) });
    seedFoldFile({ home, text: JSON.stringify({ activities: { W1, W2 }, recordedAtIso: NOW }) });

    const state = unwrap(await memoryCmuxEventStatePort().readSessionWatch({ home }));

    expect(state).toEqual({ activities: { W1, W2 }, cursorSeq: 50, revision: 1 });
  });

  it("resumes from the start of the stream when the imported fold holds no session at all", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });
    seedFoldFile({ home, text: JSON.stringify({ activities: {}, recordedAtIso: NOW }) });

    const state = unwrap(await memoryCmuxEventStatePort().readSessionWatch({ home }));

    expect(state).toEqual({ activities: {}, cursorSeq: 0, revision: 1 });
  });

  it("refuses a cursor file standing without its fold, rather than skipping the events before it", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });
    const store = memoryCmuxEventStateStore();

    const error = unwrapErr(await memoryCmuxEventStatePort({ store }).readSessionWatch({ home }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_INVALID");
    expect(error.message).toContain("so the events before its cursor were never folded");
    expect(store.rows.size).toBe(0);
  });

  it("refuses a fold file standing without its cursor, rather than folding its events twice", async () => {
    const home = freshHome();
    seedFoldFile({ home, text: FOLD_FILE });

    const error = unwrapErr(await memoryCmuxEventStatePort().readSessionWatch({ home }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_INVALID");
    expect(error.message).toContain("so resuming would fold its events a second time");
  });

  it("refuses a corrupt fold file instead of reading it as an empty fold", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });
    seedFoldFile({ home, text: "{torn" });

    const error = unwrapErr(await memoryCmuxEventStatePort().readSessionWatch({ home }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_INVALID");
    expect(error.message).toContain("the activity file: it is not JSON a reader can take");
    expect(error.message).toContain("--reset-state --since <seq>");
  });

  it("refuses a pair whose fold is ahead of its cursor — a crash between the two old writes", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: JSON.stringify({ seq: 30 }) });
    seedFoldFile({ home, text: FOLD_FILE });

    const error = unwrapErr(await memoryCmuxEventStatePort().readSessionWatch({ home }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_INVALID");
    expect(error.message).toContain("activity W1 has folded seq 38, past the cursor 30");
  });

  it("refuses a stored row that does not decode, rather than reading it as empty", async () => {
    const store = memoryCmuxEventStateStore();
    store.rows.set("session-watch", { activities: { W1: "torn" }, cursorSeq: 40, revision: 3 });

    const error = unwrapErr(await memoryCmuxEventStatePort({ store }).readSessionWatch({ home: freshHome() }));

    expect(error.code).toBe("CMUX_EVENT_STORED_INVALID");
    expect(error.message).toContain("activity W1 is not an object");
  });

  it("reads back the other importer's row when its own insert lost the race", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });
    seedFoldFile({ home, text: FOLD_FILE });
    const winner = { activities: {}, cursorSeq: 55, revision: 1 };
    let reads = 0;
    const rows: CmuxEventStateRows = {
      close: () => Promise.resolve(),
      insert: () => Promise.resolve(ok(undefined)),
      read: () => {
        reads += 1;
        return Promise.resolve(ok(reads === 1 ? undefined : winner));
      },
      update: () => Promise.resolve(ok(undefined)),
    };
    const port = storeCmuxEventStatePort({
      seams: {
        ...memoryCmuxEventStateSeams({ store: memoryCmuxEventStateStore() }),
        connect: () => Promise.resolve(ok(rows)),
      },
    });

    expect(unwrap(await port.readSessionWatch({ home }))).toEqual({ activities: {}, cursorSeq: 55, revision: 1 });
  });
});

describe("session watch's state: commits", () => {
  it("inserts the first write at revision 1 and compare-and-sets every later one", async () => {
    const home = freshHome();
    const port = memoryCmuxEventStatePort();

    const first = unwrap(
      await port.writeSessionWatch({ activities: { W1 }, cursorSeq: 40, expectedRevision: null, home, nowIso: NOW }),
    );
    const second = unwrap(
      await port.writeSessionWatch({ activities: {}, cursorSeq: 44, expectedRevision: 1, home, nowIso: NOW }),
    );

    expect(first).toEqual({ activities: { W1 }, cursorSeq: 40, revision: 1 });
    expect(second).toEqual({ activities: {}, cursorSeq: 44, revision: 2 });
  });

  it("refuses a write pinned to a revision another watcher already moved, and writes nothing", async () => {
    const home = freshHome();
    const store = memoryCmuxEventStateStore();
    const port = memoryCmuxEventStatePort({ store });
    unwrap(await port.writeSessionWatch({ activities: {}, cursorSeq: 40, expectedRevision: null, home, nowIso: NOW }));
    unwrap(await port.writeSessionWatch({ activities: {}, cursorSeq: 50, expectedRevision: 1, home, nowIso: NOW }));

    const error = unwrapErr(
      await port.writeSessionWatch({ activities: { W1 }, cursorSeq: 45, expectedRevision: 1, home, nowIso: NOW }),
    );

    expect(error.code).toBe("CMUX_EVENT_REVISION_CONFLICT");
    expect(error).toMatchObject({ expectedRevision: 1 });
    expect(store.rows.get("session-watch")).toEqual({ activities: {}, cursorSeq: 50, revision: 2 });
  });

  it("names revision 0 when a first write lost to a row that appeared meanwhile", async () => {
    const home = freshHome();
    const port = memoryCmuxEventStatePort();
    unwrap(await port.writeSessionWatch({ activities: {}, cursorSeq: 40, expectedRevision: null, home, nowIso: NOW }));

    const error = unwrapErr(
      await port.writeSessionWatch({ activities: {}, cursorSeq: 41, expectedRevision: null, home, nowIso: NOW }),
    );

    expect(error.code).toBe("CMUX_EVENT_REVISION_CONFLICT");
    expect(error).toMatchObject({ expectedRevision: 0 });
  });

  it("resets an undecodable row to an empty fold at the chosen sequence, bumping its revision", async () => {
    const store = memoryCmuxEventStateStore();
    store.rows.set("session-watch", { activities: { W1: "torn" }, cursorSeq: 40, revision: 3 });

    const state = unwrap(
      await memoryCmuxEventStatePort({ store }).resetSessionWatch({ cursorSeq: 70, home: freshHome(), nowIso: NOW }),
    );

    expect(state).toEqual({ activities: {}, cursorSeq: 70, revision: 4 });
  });

  it("resets a home with no row by inserting one, without consulting the import files", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });

    const state = unwrap(await memoryCmuxEventStatePort().resetSessionWatch({ cursorSeq: 70, home, nowIso: NOW }));

    expect(state).toEqual({ activities: {}, cursorSeq: 70, revision: 1 });
  });

  it("closes every connection it opens", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });
    const store = memoryCmuxEventStateStore();
    const port = memoryCmuxEventStatePort({ store });

    await port.readSessionWatch({ home });
    await port.readEventsCursor({ home, importFile: true });

    expect([store.opened, store.closed]).toEqual([2, 2]);
  });
});

describe("cmux events's own cursor", () => {
  it("imports the cursor file into its own row, leaving session watch's row alone", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });
    const store = memoryCmuxEventStateStore();

    const state = unwrap(await memoryCmuxEventStatePort({ store }).readEventsCursor({ home, importFile: true }));

    expect(state).toEqual({ cursorSeq: 40, revision: 1 });
    expect([...store.rows.keys()]).toEqual(["cmux-events"]);
  });

  it("ignores the cursor file when the caller passed its own start", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });
    const store = memoryCmuxEventStateStore();

    const state = unwrap(await memoryCmuxEventStatePort({ store }).readEventsCursor({ home, importFile: false }));

    expect(state).toEqual({ cursorSeq: undefined, revision: null });
    expect(store.rows.size).toBe(0);
  });

  it("refuses a corrupt cursor file, naming its own escape", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: '{"seq":"forty"}' });

    const error = unwrapErr(await memoryCmuxEventStatePort().readEventsCursor({ home, importFile: true }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_INVALID");
    expect(error.message).toContain("`slopweaver cmux events --since <seq>`");
  });

  it("advances its cursor by compare-and-set, never touching session watch's row", async () => {
    const home = freshHome();
    const store = memoryCmuxEventStateStore();
    const port = memoryCmuxEventStatePort({ store });

    unwrap(await port.writeEventsCursor({ cursorSeq: 12, expectedRevision: null, home, nowIso: NOW }));
    const moved = unwrap(await port.writeEventsCursor({ cursorSeq: 20, expectedRevision: 1, home, nowIso: NOW }));

    expect(moved).toEqual({ cursorSeq: 20, revision: 2 });
    expect(store.rows.get("cmux-events")!.activities).toBeNull();
    expect(store.rows.has("session-watch")).toBe(false);
  });
});

describe("a store that cannot be reached", () => {
  it("refuses as CMUX_EVENT_STORE_UNAVAILABLE when the connection rejects, and never reads a file", async () => {
    const home = freshHome();
    seedCursorFile({ home, text: CURSOR_FILE });
    seedFoldFile({ home, text: FOLD_FILE });
    const port = storeCmuxEventStatePort({
      seams: {
        ...memoryCmuxEventStateSeams({ store: memoryCmuxEventStateStore() }),
        connect: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:54322")),
      },
    });

    const error = unwrapErr(await port.readSessionWatch({ home }));

    expect(error.code).toBe("CMUX_EVENT_STORE_UNAVAILABLE");
    expect(error.message).toBe(
      "the store could not be opened (connect ECONNREFUSED 127.0.0.1:54322) — nothing was read or written; `slopweaver store status` says why",
    );
  });

  it("never carries a connection string's credential into the refusal", async () => {
    const port = storeCmuxEventStatePort({
      seams: {
        ...memoryCmuxEventStateSeams({ store: memoryCmuxEventStateStore() }),
        connect: () =>
          Promise.reject(
            new Error("connection failed: postgresql://acme:FIXTURE-s3cr3t@127.0.0.1:5432/db password=FIXTURE-pw"),
          ),
      },
    });

    const error = unwrapErr(await port.readSessionWatch({ home: freshHome() }));

    expect(error.message).toContain("postgresql://[redacted]@127.0.0.1:5432/db password=[redacted]");
    expect(error.message).not.toContain("FIXTURE-s3cr3t");
    expect(error.message).not.toContain("FIXTURE-pw");
  });

  it("redacts from a libpq password keyword to the end, so no spacing, quote or escape can carry a value past it", () => {
    const reason =
      "host=127.0.0.1 user=acme password = \\\nFIXTURE-escaped dbname=db sslpassword='FIXTURE quoted \\' tail' port=5432";

    expect(withoutCredentials({ text: reason })).toBe("host=127.0.0.1 user=acme password = [redacted]");
  });

  it("drops a URL's whole query and fragment, so a percent-encoded password key cannot slip past", () => {
    const reason =
      "connect failed: postgresql://127.0.0.1:1/db?pass%77ord=FIXTURE-encoded&sslmode=disable#FIXTURE-frag";

    expect(withoutCredentials({ text: reason })).toBe("connect failed: postgresql://127.0.0.1:1/db?[redacted]");
  });

  it("redacts a URL's userinfo whole when its password carries an unencoded slash or at sign", () => {
    const reason = "connect failed: postgresql://acme:FIX/TU@RE@127.0.0.1:1/db";

    expect(withoutCredentials({ text: reason })).toBe("connect failed: postgresql://[redacted]@127.0.0.1:1/db");
  });

  it("redacts everything after the scheme when a query value carries an at sign", () => {
    const reason = "connect failed: postgresql://127.0.0.1/db?token=FIXTURE-SECRET@FIXTURE-TAIL";

    expect(withoutCredentials({ text: reason })).toBe("connect failed: postgresql://[redacted]");
  });

  it("redacts everything after the scheme when a password carries an unencoded question mark", () => {
    const reason = "connect failed: postgresql://acme:FIX?TURE@127.0.0.1:1/db";

    expect(withoutCredentials({ text: reason })).toBe("connect failed: postgresql://[redacted]");
  });
});
