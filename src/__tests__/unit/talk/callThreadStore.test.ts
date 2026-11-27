/*
 * The call-thread journal on disk: private modes, a retried batch written once, rotation into numbered parts, a torn
 * line skipped and counted, a missing journal an error, and a malformed batch refused whole.
 */
import {
  appendFileSync,
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { threadsDir } from "../../../talk/callThreadDir.js";
import type { CallThreadWireEntry } from "../../../talk/callThreadEntry.js";
import { CallThreadErrors } from "../../../talk/callThreadErrors.js";
import { appendPinned, regularJournalFiles } from "../../../talk/callThreadFiles.js";
import { callThreadFileName, callThreadFilesOf, placeLines } from "../../../talk/callThreadParts.js";
import {
  appendCallThreadEntries,
  parseCallThreadBatch,
  readCallThreadBatch,
  readCallThreadEntries,
} from "../../../talk/callThreadStore.js";

const CALL = "a0000041-0000-4000-8000-000000000044";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-threads-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const wire = ({ n, text = "said" }: { n: number; text?: string }): CallThreadWireEntry => ({
  callId: CALL,
  capture: { kind: "notification", method: "item/completed", params: { item: { text, type: "agentMessage" } } },
  receivedAtIso: "2026-11-02T05:00:00.000Z",
  version: 1,
  writeId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
});

/** Append as writer pid 101, running, so no `ps` is spawned to ask. */
const append = (over: Partial<Parameters<typeof appendCallThreadEntries>[0]>) =>
  appendCallThreadEntries({
    callId: CALL,
    denylist: [],
    entries: [wire({ n: 1 })],
    home,
    instance: undefined,
    pid: 101,
    startOf: (pid) => (pid === 101 ? { running: true, start: "t101" } : { running: false, start: undefined }),
    ...over,
  });

describe("appendCallThreadEntries", () => {
  it("writes a 0600 file in a 0700 directory, and reads it back", () => {
    expect(unwrap(append({})).appended).toBe(1);
    const dir = threadsDir({ home });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, `${CALL}.jsonl`)).mode & 0o777).toBe(0o600);
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    expect(read.entries.map((e) => e.writeId)).toEqual([wire({ n: 1 }).writeId]);
    expect(read.skipped).toBe(0);
  });

  it("writes a retried batch once, however many times it arrives", () => {
    unwrap(append({ entries: [wire({ n: 1 }), wire({ n: 2 })] }));
    const again = unwrap(append({ entries: [wire({ n: 2 }), wire({ n: 3 })] }));
    expect(again).toEqual({ appended: 1, paths: [join(threadsDir({ home }), `${CALL}.jsonl`)], repeated: 1 });
    expect(unwrap(readCallThreadEntries({ callId: CALL, home })).entries.length).toBe(3);
  });

  it("rotates into a numbered part before a file passes its ceiling, and reads every part in order", () => {
    unwrap(append({ entries: [wire({ n: 1, text: "a".repeat(300) })], partMaxBytes: 600 }));
    unwrap(append({ entries: [wire({ n: 2, text: "b".repeat(300) })], partMaxBytes: 600 }));
    unwrap(append({ entries: [wire({ n: 3, text: "c".repeat(300) })], partMaxBytes: 600 }));
    expect(
      readdirSync(threadsDir({ home }))
        .filter((name) => name.endsWith(".jsonl"))
        .toSorted(),
    ).toEqual([`${CALL}.jsonl`, `${CALL}.part-000001.jsonl`, `${CALL}.part-000002.jsonl`]);
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    expect(read.entries.map((e) => e.writeId)).toEqual([1, 2, 3].map((n) => wire({ n }).writeId));
  });

  it("skips and counts a torn last line, and still takes the retry of the entry it was", () => {
    unwrap(append({}));
    appendFileSync(join(threadsDir({ home }), `${CALL}.jsonl`), '{"version":1,"writeId":"00000000-0000-4000-8000-0000');
    expect(unwrap(readCallThreadEntries({ callId: CALL, home })).skipped).toBe(1);
    expect(unwrap(append({ entries: [wire({ n: 2 })] })).appended).toBe(1);
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    expect(read.entries.length).toBe(2);
    expect(read.skipped).toBe(1);
  });

  it("counts a writeId as written only on a line the reader keeps, never on a malformed one carrying it", () => {
    unwrap(append({ entries: [wire({ n: 2 })] }));
    appendFileSync(
      join(threadsDir({ home }), `${CALL}.jsonl`),
      `${JSON.stringify({ writeId: wire({ n: 1 }).writeId })}\n`,
    );
    expect(unwrap(append({})).appended).toBe(1);
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    expect([read.entries.map((e) => e.writeId), read.skipped]).toEqual([
      [wire({ n: 2 }).writeId, wire({ n: 1 }).writeId],
      1,
    ]);
  });

  it("refuses a written writeId carried by a different capture, rather than counting it repeated", () => {
    unwrap(append({ entries: [wire({ n: 1, text: "first capture" })] }));
    const collided = unwrapErr(append({ entries: [wire({ n: 2 }), wire({ n: 1, text: "second capture" })] }));
    expect(collided).toEqual(CallThreadErrors.writeIdCollision({ writeId: wire({ n: 1 }).writeId }));
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    expect(read.entries.map((e) => e.writeId)).toEqual([wire({ n: 1 }).writeId]);
    expect(unwrap(append({ entries: [wire({ n: 1, text: "first capture" })] })).repeated).toBe(1);
  });

  it("stamps every entry of the desktop test instance's batch, and reads the owner's back with no instance", () => {
    unwrap(append({ entries: [wire({ n: 1 }), wire({ n: 2 })], instance: "e2e" }));
    unwrap(append({ entries: [wire({ n: 3 })] }));
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    expect(read.entries.map((e) => [e.writeId, e.instance])).toEqual([
      [wire({ n: 1 }).writeId, "e2e"],
      [wire({ n: 2 }).writeId, "e2e"],
      [wire({ n: 3 }).writeId, undefined],
    ]);
    const lines = readFileSync(join(threadsDir({ home }), `${CALL}.jsonl`), "utf8")
      .trimEnd()
      .split("\n");
    expect(lines.map((line) => line.includes('"instance":"e2e"'))).toEqual([true, true, false]);
    expect(lines[2]).not.toContain('"instance"');
    expect(read.skipped).toBe(0);
  });

  it("writes a test instance's retry once, and refuses its writeId arriving as the owner's", () => {
    unwrap(append({ entries: [wire({ n: 1 })], instance: "e2e" }));
    expect(unwrap(append({ entries: [wire({ n: 1 })], instance: "e2e" })).repeated).toBe(1);
    expect(unwrapErr(append({ entries: [wire({ n: 1 })] }))).toEqual(
      CallThreadErrors.writeIdCollision({ writeId: wire({ n: 1 }).writeId }),
    );
    expect(unwrap(readCallThreadEntries({ callId: CALL, home })).entries.map((e) => e.instance)).toEqual(["e2e"]);
  });

  it("refuses an id that is not a call's", () => {
    expect(unwrapErr(append({ callId: "../calls/x" })).code).toBe("CALL_THREAD_CALL_INVALID");
  });

  it("refuses a journal path that is a symlink, writing nothing through it to the call it points at", () => {
    const dir = threadsDir({ home });
    const other = "a0000079-0000-4000-8000-000000000086";
    unwrap(append({ callId: other, entries: [{ ...wire({ n: 9 }), callId: other }] }));
    const target = join(dir, `${other}.jsonl`);
    const before = readFileSync(target, "utf8");
    symlinkSync(target, join(dir, `${CALL}.jsonl`));
    const link = join(dir, `${CALL}.jsonl`);
    expect([
      unwrapErr(append({})),
      unwrapErr(readCallThreadEntries({ callId: CALL, home })),
      unwrapErr(regularJournalFiles({ callId: CALL, dir })),
    ]).toEqual([
      CallThreadErrors.notAFile({ path: link }),
      CallThreadErrors.notAFile({ path: link }),
      CallThreadErrors.notAFile({ path: link }),
    ]);
    expect(unwrap(regularJournalFiles({ callId: other, dir }))).toEqual([{ index: 0, name: `${other}.jsonl` }]);
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  it("pins every file at its open, so a name swapped for a link after the listing writes nothing, not half a batch", () => {
    const dir = threadsDir({ home });
    unwrap(append({}));
    const own = join(dir, `${CALL}.jsonl`);
    const ownBefore = readFileSync(own, "utf8");
    const elsewhere = join(dir, "elsewhere.jsonl");
    writeFileSync(elsewhere, "kept\n");
    const linked = join(dir, `${CALL}.part-000001.jsonl`);
    linkSync(elsewhere, linked);
    const symlinked = join(dir, `${CALL}.part-000002.jsonl`);
    symlinkSync(elsewhere, symlinked);
    const write = ({ path }: { path: string }) => ({ path, text: "late\n" });
    expect([
      unwrapErr(appendPinned({ writes: [write({ path: own }), write({ path: linked })] })),
      unwrapErr(appendPinned({ writes: [write({ path: own }), write({ path: symlinked })] })),
    ]).toEqual([CallThreadErrors.notAFile({ path: linked }), CallThreadErrors.notAFile({ path: symlinked })]);
    expect([readFileSync(own, "utf8"), readFileSync(elsewhere, "utf8")]).toEqual([ownBefore, "kept\n"]);
  });

  it("refuses a threads directory, or the talk directory above it, that is a symlink, writing nothing outside home", () => {
    const dir = threadsDir({ home });
    const outside = mkdtempSync(join(tmpdir(), "sw-outside-"));
    try {
      // Not 0700, so a chmod followed through the link would show.
      chmodSync(outside, 0o755);
      mkdirSync(join(home, "talk"), { recursive: true });
      symlinkSync(outside, dir);
      expect([unwrapErr(append({})), unwrapErr(readCallThreadEntries({ callId: CALL, home }))]).toEqual([
        CallThreadErrors.notAFile({ path: dir }),
        CallThreadErrors.notAFile({ path: dir }),
      ]);
      rmSync(dir);
      rmSync(join(home, "talk"), { recursive: true });
      symlinkSync(outside, join(home, "talk"));
      expect(unwrapErr(append({}))).toEqual(CallThreadErrors.notAFile({ path: join(home, "talk") }));
      expect([readdirSync(outside), statSync(outside).mode & 0o777]).toEqual([[], 0o755]);
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("refuses a journal path hard-linked to another call's, for both calls, writing nothing into the shared file", () => {
    const dir = threadsDir({ home });
    const other = "a0000079-0000-4000-8000-000000000086";
    unwrap(append({ callId: other, entries: [{ ...wire({ n: 9 }), callId: other }] }));
    const target = join(dir, `${other}.jsonl`);
    const before = readFileSync(target, "utf8");
    linkSync(target, join(dir, `${CALL}.jsonl`));
    expect([
      unwrapErr(append({})),
      unwrapErr(append({ callId: other, entries: [{ ...wire({ n: 8 }), callId: other }] })),
    ]).toEqual([
      CallThreadErrors.notAFile({ path: join(dir, `${CALL}.jsonl`) }),
      CallThreadErrors.notAFile({ path: target }),
    ]);
    expect(readFileSync(target, "utf8")).toBe(before);
  });
});

describe("readCallThreadEntries", () => {
  it("keeps no line naming another call, counting it skipped", () => {
    unwrap(append({}));
    const foreign = { ...wire({ n: 2 }), callId: "a0000079-0000-4000-8000-000000000086" };
    appendFileSync(join(threadsDir({ home }), `${CALL}.jsonl`), `${JSON.stringify(foreign)}\n`);
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    expect([read.entries.map((e) => e.writeId), read.skipped]).toEqual([[wire({ n: 1 }).writeId], 1]);
  });

  it("answers a call with no journal as missing, never an empty read", () => {
    const missing = unwrapErr(readCallThreadEntries({ callId: CALL, home }));
    expect(missing).toEqual(
      CallThreadErrors.missing({ callId: CALL, path: join(threadsDir({ home }), `${CALL}.jsonl`) }),
    );
  });
});

describe("CallThreadErrors", () => {
  it("names a surviving secret by label and an unreadable path by its cause", () => {
    expect(CallThreadErrors.secretSurvived({ labels: ["denylist", "github-oauth-token"] }).message).toBe(
      "a denylist, github-oauth-token hit survived masking and the withheld stand-in, so the batch is not written",
    );
    expect(CallThreadErrors.pathFailed({ cause: new Error("EACCES"), path: "/x" }).message).toBe("/x: EACCES");
  });
});

describe("readCallThreadBatch", () => {
  const batch = ({ lines }: { lines: readonly string[] }): string => {
    const path = join(home, "batch.jsonl");
    writeFileSync(path, lines.map((line) => `${line}\n`).join(""));
    return path;
  };

  it("takes a batch of this call's entries", () => {
    const path = batch({ lines: [JSON.stringify(wire({ n: 1 })), "", JSON.stringify(wire({ n: 2 }))] });
    expect(unwrap(readCallThreadBatch({ callId: CALL, path })).length).toBe(2);
  });

  it("refuses the whole batch for one bad line, another call's entry, or a writeId twice", () => {
    const other = { ...wire({ n: 2 }), callId: "a0000080-0000-4000-8000-000000000087" };
    const cases = [
      [JSON.stringify(wire({ n: 1 })), "{not json"],
      [JSON.stringify(wire({ n: 1 })), JSON.stringify(other)],
      [JSON.stringify(wire({ n: 1 })), JSON.stringify(wire({ n: 1 }))],
    ];
    const codes = cases.map((lines) => unwrapErr(readCallThreadBatch({ callId: CALL, path: batch({ lines }) })).code);
    expect(codes).toEqual(["CALL_THREAD_BATCH_INVALID", "CALL_THREAD_BATCH_INVALID", "CALL_THREAD_BATCH_INVALID"]);
  });
});

describe("parseCallThreadBatch", () => {
  it("takes a piped batch by the same rules, naming stdin when it refuses one", () => {
    const text = `${JSON.stringify(wire({ n: 1 }))}\n\n${JSON.stringify(wire({ n: 2 }))}\n`;
    expect(unwrap(parseCallThreadBatch({ callId: CALL, text })).map((e) => e.writeId)).toEqual(
      [1, 2].map((n) => wire({ n }).writeId),
    );
    const refused = unwrapErr(
      parseCallThreadBatch({ callId: CALL, text: `${JSON.stringify(wire({ n: 1 }))}\nnope\n` }),
    );
    expect(refused.message).toBe(
      `the call-thread batch at stdin is refused: line(s) 2 are not call-thread entries for call ${CALL}`,
    );
  });
});

describe("callThreadFilesOf and placeLines", () => {
  it("orders the primary first, then parts by number, and ignores another call's and a malformed name", () => {
    const names = [
      `${CALL}.part-000002.jsonl`,
      "x.jsonl",
      `${CALL}.jsonl`,
      `${CALL}.part-1.jsonl`,
      `${CALL}.part-000001.jsonl`,
    ];
    expect(callThreadFilesOf({ callId: CALL, names }).map((file) => file.index)).toEqual([0, 1, 2]);
  });

  it("reads past part 999999 whatever name the writer gave it, and no non-canonical spelling of a part", () => {
    const names = [
      callThreadFileName({ callId: CALL, index: 1_000_000 }),
      `${CALL}.part-999999.jsonl`,
      `${CALL}.part-0000001.jsonl`,
    ];
    expect(callThreadFilesOf({ callId: CALL, names })).toEqual([
      { index: 999_999, name: `${CALL}.part-999999.jsonl` },
      { index: 1_000_000, name: `${CALL}.part-1000000.jsonl` },
    ]);
  });

  it("starts a new part only when a non-empty file would pass the ceiling", () => {
    expect(placeLines({ lastBytes: 0, lastIndex: 0, lineBytes: [10, 10, 10], maxBytes: 20 })).toEqual([0, 0, 1]);
    expect(placeLines({ lastBytes: 15, lastIndex: 3, lineBytes: [5, 1], maxBytes: 20 })).toEqual([3, 4]);
    expect(placeLines({ lastBytes: 0, lastIndex: 0, lineBytes: [50], maxBytes: 20 })).toEqual([0]);
  });
});
