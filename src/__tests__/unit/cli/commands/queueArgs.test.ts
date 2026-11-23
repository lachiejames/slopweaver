/*
 * The argv vocabulary every `slopweaver queue` verb shares, driven directly.
 *
 * `VERB_ARG_OFFSET` is the reason this matters rather than being ceremony: `slopweaver turn answer` had
 * exactly this index wrong once while the whole unit suite passed, because the tests built the tail they
 * expected instead of the argv the router really hands a verb. So every case here builds the full
 * `[node, cli, queue, <verb>, …]` shape and lets `verbArgs` find the tail itself.
 *
 * `--home` is always passed, so nothing here can read or write the operator's own state home.
 */
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendQueueEvent, queueLogPath } from "../../../../admit/queueStore.js";
import { QUEUE_DROP_USAGE, QUEUE_LIST_USAGE } from "../../../../cli/commands/queue/core.js";
import { findItem, loadQueue, noteText, str, verbArgs } from "../../../../cli/commands/queue/queueArgs.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-queue-args-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The argv the router hands a verb: `[node, cli, queue, <verb>, …]`. */
function argv({ verb = "list", tail }: { verb?: string; tail: readonly string[] }): readonly string[] {
  return ["node", "cli", "queue", verb, ...tail];
}

/** File one held draft under `id`, through the real store. */
function fileHeld({ id }: { id: string }): void {
  appendQueueEvent({
    event: {
      held: {
        askedBy: "U_COLLEAGUE",
        channel: "C1",
        code: "withhold.reply",
        draft: { kind: "update", tldr: "we render rich_text" },
        messageTs: "1712345678.000100",
        question: "what did we decide about the renderer?",
        reason: "not the owner",
        surface: "channel",
        threadTs: "1712345678.000100",
      },
      id,
      kind: "held",
      tsIso: "2026-08-06T01:00:00.000Z",
    },
    home,
  });
}

describe("verbArgs", () => {
  it("reads the tail at the REAL offset, so a positional is not eaten by the noun or the verb", () => {
    const args = verbArgs({
      argv: argv({ tail: ["abc-123", "--home", home] }),
      usage: QUEUE_LIST_USAGE,
      verb: "list",
    })!;
    expect(args.positionals).toEqual(["abc-123"]);
    expect(args.home).toBe(home);
  });

  it("answers undefined for an unknown flag rather than ignoring it", () => {
    expect(verbArgs({ argv: argv({ tail: ["--nope"] }), usage: QUEUE_LIST_USAGE, verb: "list" })).toBe(undefined);
  });

  it("carries a flag's value through under its own name", () => {
    const args = verbArgs({
      argv: argv({ tail: ["abc-123", "--home", home, "--note", "released by hand"], verb: "drop" }),
      usage: QUEUE_DROP_USAGE,
      verb: "drop",
    })!;
    expect(args.values["note"]).toBe("released by hand");
  });
});

describe("str and noteText", () => {
  it('reads a string flag and answers undefined for a boolean one, never the string "true"', () => {
    expect(str({ key: "home", values: { home: "/tmp/x" } })).toBe("/tmp/x");
    expect(str({ key: "dry-run", values: { "dry-run": true } })).toBe(undefined);
  });

  it("answers the empty string for an absent note, because the event shape has no optional note", () => {
    expect(noteText({ values: {} })).toBe("");
    expect(noteText({ values: { note: true } })).toBe("");
    expect(noteText({ values: { note: "by hand" } })).toBe("by hand");
  });
});

describe("loadQueue and findItem", () => {
  it("reads an empty home as an empty queue rather than as an unreadable one", () => {
    const loaded = loadQueue({ home });
    expect(loaded.items).toEqual([]);
    expect(loaded.unreadable).toEqual([]);
  });

  it("folds a filed draft into one held item", () => {
    fileHeld({ id: "abc-123" });
    const loaded = loadQueue({ home });
    expect(loaded.items.length).toBe(1);
    expect(loaded.items[0]!.id).toBe("abc-123");
    expect(loaded.items[0]!.state).toBe("held");
  });

  it("finds an item by id, and answers undefined for one the log does not name", () => {
    fileHeld({ id: "abc-123" });
    expect(findItem({ home, id: "abc-123" })!.id).toBe("abc-123");
    expect(findItem({ home, id: "def-456" })).toBe(undefined);
  });

  it("reports a line it could not read by its own line number, rather than dropping it", () => {
    fileHeld({ id: "abc-123" });
    appendFileSync(queueLogPath({ home }), "{not json\n");
    const loaded = loadQueue({ home });
    expect(loaded.items.length).toBe(1);
    expect(loaded.unreadable).toEqual([2]);
  });
});
